import { Plugin } from 'ckeditor5/src/core';

import DescriptionListCommand from './descriptionlistcommand';
import {
	// cleanList,
	// cleanListItem,
	modelChangePostFixerTODO,
	modelIndentPasteFixer
	// modelViewSplitOnInsert,
	// viewModelConverter,
	// viewToModelPosition
} from './converters';

/**
 * It registers the `'descriptionList'`, `'descriptionTerm'`, `'descriptionValue'` commands.
 *
 * @extends moddle:core/plugin~Plugin
 */
export default class DescriptionListEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'DescriptionListEditing';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;

		_preInit( editor );

		// Register commands.
		editor.commands.add( 'descriptionList', new DescriptionListCommand( editor, 'dl' ) );
		editor.commands.add( 'descriptionTerm', new DescriptionListCommand( editor, 'dt' ) );
		editor.commands.add( 'descriptionValue', new DescriptionListCommand( editor, 'dd' ) );
	}
}

function _preInit( editor ) {
	// Converters.
	const data = editor.data;
	const editing = editor.editing;

	editor.model.schema.register( 'descriptionListItem', {
		inheritAllFrom: '$block',
		allowAttributes: [ 'listType' ]
	} );

	editor.model.document.registerPostFixer( writer => modelChangePostFixerTODO( editor.model, writer ) );

	[ 'dt', 'dd' ].map( element => {
		editing.mapper.registerViewToModelLength( element, getViewListItemLength );
		data.mapper.registerViewToModelLength( element, getViewListItemLength );
	} );

	// editing.mapper.on( 'viewToModelPosition', viewToModelPosition( editor.model ) );
	// editing.mapper.on( 'modelToViewPosition', modelToViewPosition( editing.view ) );
	// data.mapper.on( 'modelToViewPosition', modelToViewPosition( editing.view ) );

	// editor.conversion.for( 'editingDowncast' )
	// 	.add( dispatcher => {
	// 		dispatcher.on( 'insert', modelViewSplitOnInsert, { priority: 'high' } );
	// 		dispatcher.on( 'insert:descriptionListItem', modelViewInsertion( editor.model ) );
	// 		dispatcher.on( 'attribute:listType:descriptionListItem', modelViewChangeType, { priority: 'high' } );
	// 		dispatcher.on( 'attribute:listType:descriptionListItem', modelViewMergeAfterChangeType, { priority: 'low' } );
	// 		dispatcher.on( 'remove:descriptionListItem', modelViewRemove( editor.model ) );
	// 		dispatcher.on( 'remove', modelViewMergeAfter, { priority: 'low' } );
	// 	} );

	// editor.conversion.for( 'dataDowncast' )
	// 	.add( dispatcher => {
	// 		dispatcher.on( 'insert', modelViewSplitOnInsert, { priority: 'high' } );
	// 		dispatcher.on( 'insert:descriptionListItem', modelViewInsertion( editor.model ) );
	// 	} );

	// editor.conversion.for( 'upcast' )
	// 	.add( dispatcher => {
	// 		dispatcher.on( 'element:dl', cleanList, { priority: 'high' } );
	// 		dispatcher.on( 'element:dt', cleanListItem, { priority: 'high' } );
	// 		dispatcher.on( 'element:dd', cleanListItem, { priority: 'high' } );
	// 		dispatcher.on( 'element:dt', viewModelConverter );
	// 		dispatcher.on( 'element:dd', viewModelConverter );
	// 	} );

	// Fix indentation of pasted items.
	editor.model.on( 'insertContent', modelIndentPasteFixer, { priority: 'high' } );
}

function getViewListItemLength( element ) {
	let length = 1;

	for ( const child of element.getChildren() ) {
		if ( child.name == 'dl' ) {
			for ( const item of child.getChildren() ) {
				length += getViewListItemLength( item );
			}
		}
	}

	return length;
}
