/**
 * External dependencies
 */
import { BEGIN, COMMIT, REVERT } from 'redux-optimist';
import { get, uniqueId } from 'lodash';

/**
 * WordPress dependencies
 */
import { serialize, getBlockType, switchToBlockType } from 'blocks';
import { __ } from 'i18n';

/**
 * Internal dependencies
 */
import { getGutenbergURL, getWPAdminURL } from './utils/url';
import { focusBlock, replaceBlocks, createSuccessNotice, createErrorNotice } from './actions';
import {
	getCurrentPost,
	getCurrentPostType,
	getBlocks,
	getPostEdits,
} from './selectors';

export default {
	REQUEST_POST_UPDATE( action, store ) {
		const { dispatch, getState } = store;
		const state = getState();
		const post = getCurrentPost( state );
		const isNew = ! post.id;
		const edits = getPostEdits( state );
		const toSend = {
			...edits,
			content: serialize( getBlocks( state ) ),
		};
		const transactionId = uniqueId();

		if ( ! isNew ) {
			toSend.id = post.id;
		}

		dispatch( {
			type: 'CLEAR_POST_EDITS',
			optimist: { type: BEGIN, id: transactionId },
		} );
		dispatch( {
			type: 'UPDATE_POST',
			edits: toSend,
			optimist: { id: transactionId },
		} );
		const Model = wp.api.getPostTypeModel( getCurrentPostType( state ) );
		new Model( toSend ).save().done( ( newPost ) => {
			dispatch( {
				type: 'RESET_POST',
				post: newPost,
			} );
			dispatch( {
				type: 'REQUEST_POST_UPDATE_SUCCESS',
				previousPost: post,
				post: newPost,
				isNew,
				optimist: { type: COMMIT, id: transactionId },
			} );
		} ).fail( ( err ) => {
			dispatch( {
				type: 'REQUEST_POST_UPDATE_FAILURE',
				error: get( err, 'responseJSON', {
					code: 'unknown_error',
					message: __( 'An unknown error occurred.' ),
				} ),
				post,
				edits,
				optimist: { type: REVERT, id: transactionId },
			} );
		} );
	},
	REQUEST_POST_UPDATE_SUCCESS( action, store ) {
		const { previousPost, post, isNew } = action;
		const { dispatch } = store;

		const publishStatus = [ 'publish', 'private', 'future' ];
		const isPublished = publishStatus.indexOf( previousPost.status ) !== -1;
		const messages = {
			publish: __( 'Post published!' ),
			'private': __( 'Post published privately!' ),
			future: __( 'Post scheduled!' ),
		};

		// If we save a non published post, we don't show any notice
		// If we publish/schedule a post, we show the corresponding publish message
		// Unless we show an update notice
		if ( isPublished || publishStatus.indexOf( post.status ) !== -1 ) {
			const noticeMessage = ! isPublished && publishStatus.indexOf( post.status ) !== -1
				? messages[ post.status ]
				: __( 'Post updated!' );
			dispatch( createSuccessNotice(
				<p>
					<span>{ noticeMessage }</span>
					{ ' ' }
					<a href={ post.link } target="_blank">{ __( 'View post' ) }</a>
				</p>
			) );
		}

		if ( ! isNew ) {
			return;
		}
		const newURL = getGutenbergURL( {
			post_id: post.id,
		} );
		window.history.replaceState( {}, 'Post ' + post.id, newURL );
	},
	REQUEST_POST_UPDATE_FAILURE( action, store ) {
		const { post, edits } = action;
		const { dispatch } = store;

		const publishStatus = [ 'publish', 'private', 'future' ];
		const isPublished = publishStatus.indexOf( post.status ) !== -1;
		// If the post was being published, we show the corresponding publish error message
		// Unless we publish an "updating failed" message
		const messages = {
			publish: __( 'Publishing failed' ),
			'private': __( 'Publishing failed' ),
			future: __( 'Scheduling failed' ),
		};
		const noticeMessage = ! isPublished && publishStatus.indexOf( edits.status ) !== -1
			? messages[ edits.status ]
			: __( 'Updating failed' );
		dispatch( createErrorNotice( noticeMessage ) );
	},
	TRASH_POST( action, store ) {
		const { dispatch, getState } = store;
		const { postId } = action;
		const Model = wp.api.getPostTypeModel( getCurrentPostType( getState() ) );
		new Model( { id: postId } ).destroy().then(
			() => {
				dispatch( {
					...action,
					type: 'TRASH_POST_SUCCESS',
				} );
			},
			( err ) => {
				dispatch( {
					...action,
					type: 'TRASH_POST_FAILURE',
					error: get( err, 'responseJSON', {
						code: 'unknown_error',
						message: __( 'An unknown error occurred.' ),
					} ),
				} );
			}
		);
	},
	TRASH_POST_SUCCESS( action ) {
		const { postId, postType } = action;

		// Delay redirect to ensure store has been updated with the successful trash.
		setTimeout( () => {
			window.location.href = getWPAdminURL( 'edit.php', {
				trashed: 1,
				post_type: postType,
				ids: postId,
			} );
		} );
	},
	TRASH_POST_FAILURE( action, store ) {
		const message = action.error.message && action.error.code !== 'unknown_error' ? action.error.message : __( 'Trashing failed' );
		store.dispatch( createErrorNotice( message ) );
	},
	MERGE_BLOCKS( action, store ) {
		const { dispatch } = store;
		const [ blockA, blockB ] = action.blocks;
		const blockType = getBlockType( blockA.name );

		// Only focus the previous block if it's not mergeable
		if ( ! blockType.merge ) {
			dispatch( focusBlock( blockA.uid ) );
			return;
		}

		// We can only merge blocks with similar types
		// thus, we transform the block to merge first
		const blocksWithTheSameType = blockA.name === blockB.name
			? [ blockB ]
			: switchToBlockType( blockB, blockA.name );

		// If the block types can not match, do nothing
		if ( ! blocksWithTheSameType || ! blocksWithTheSameType.length ) {
			return;
		}

		// Calling the merge to update the attributes and remove the block to be merged
		const updatedAttributes = blockType.merge(
			blockA.attributes,
			blocksWithTheSameType[ 0 ].attributes
		);

		dispatch( focusBlock( blockA.uid, { offset: -1 } ) );
		dispatch( replaceBlocks(
			[ blockA.uid, blockB.uid ],
			[
				{
					...blockA,
					attributes: {
						...blockA.attributes,
						...updatedAttributes,
					},
				},
				...blocksWithTheSameType.slice( 1 ),
			]
		) );
	},
};
