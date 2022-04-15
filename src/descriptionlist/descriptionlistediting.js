import { Plugin } from 'ckeditor5/src/core';
import { Enter } from 'ckeditor5/src/enter';
import { Delete } from 'ckeditor5/src/typing';
import IndentCommand from '@ckeditor/ckeditor5-list/src/list/indentcommand';
import ListUtils from '@ckeditor/ckeditor5-list/src/list/listutils';
import {
	cleanList,
	cleanListItem,
	modelChangePostFixer,
	modelIndentPasteFixer,
	modelToViewPosition,
	modelViewChangeType,
	modelViewInsertion,
	modelViewRemove,
	modelViewSplitOnInsert,
	modelViewMergeAfterChangeType,
	modelViewMergeAfter,
	modelViewChangeIndent,
	viewModelConverter,
	viewToModelPosition
} from '@ckeditor/ckeditor5-list/src/list/converters';

import DescriptionListCommand from './descriptionlistcommand';

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
	static get requires() {
		return [ Enter, Delete, ListUtils ];
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;

		// Note: in case `$block` will ever be allowed in `descriptionlistItem`, keep in mind that this feature
		// uses `Selection#getSelectedBlocks()` without any additional processing to obtain all selected list items.
		// If there are blocks allowed inside list item, algorithms using `getSelectedBlocks()` will have to be modified.
		editor.model.schema.register( 'descriptionlistItem', {
			inheritAllFrom: '$block',
			allowAttributes: [ 'listType', 'listIndent' ]
		} );

		// Converters.
		const data = editor.data;
		const editing = editor.editing;
		editor.model.document.registerPostFixer( writer => modelChangePostFixer( editor.model, writer ) );
		[ 'dt', 'dd' ].map( element => {
			editing.mapper.registerViewToModelLength( element, getViewListItemLength );
			data.mapper.registerViewToModelLength( element, getViewListItemLength );
		} );

		editing.mapper.on( 'modelToViewPosition', modelToViewPosition( editing.view ) );
		editing.mapper.on( 'viewToModelPosition', viewToModelPosition( editor.model ) );
		data.mapper.on( 'modelToViewPosition', modelToViewPosition( editing.view ) );
		editor.conversion.for( 'editingDowncast' )
			.add( dispatcher => {
				dispatcher.on( 'insert', modelViewSplitOnInsert, { priority: 'high' } );
				dispatcher.on( 'insert:descriptionlistItem', modelViewInsertion( editor.model ) );
				dispatcher.on( 'attribute:listType:descriptionlistItem', modelViewChangeType, { priority: 'high' } );
				dispatcher.on( 'attribute:listType:descriptionlistItem', modelViewMergeAfterChangeType, { priority: 'low' } );
				dispatcher.on( 'attribute:listIndent:descriptionlistItem', modelViewChangeIndent( editor.model ) );
				dispatcher.on( 'remove:descriptionlistItem', modelViewRemove( editor.model ) );
				dispatcher.on( 'remove', modelViewMergeAfter, { priority: 'low' } );
			} );
		editor.conversion.for( 'dataDowncast' )
			.add( dispatcher => {
				dispatcher.on( 'insert', modelViewSplitOnInsert, { priority: 'high' } );
				dispatcher.on( 'insert:descriptionlistItem', modelViewInsertion( editor.model ) );
			} );
		editor.conversion.for( 'upcast' )
			.add( dispatcher => {
				dispatcher.on( 'element:dl', cleanList, { priority: 'high' } );
				dispatcher.on( 'element:dt', cleanListItem, { priority: 'high' } );
				dispatcher.on( 'element:dd', cleanListItem, { priority: 'high' } );
				dispatcher.on( 'element:dt', viewModelConverter );
				dispatcher.on( 'element:dd', viewModelConverter );
			} );
		// Fix indentation of pasted items.
		editor.model.on( 'insertContent', modelIndentPasteFixer, { priority: 'high' } );
		// Register commands.
		editor.commands.add( 'descriptionList', new DescriptionListCommand( editor, 'dl' ) );
		editor.commands.add( 'descriptionTerm', new DescriptionListCommand( editor, 'dt' ) );
		editor.commands.add( 'descriptionValue', new DescriptionListCommand( editor, 'dd' ) );
		// Register commands for indenting.
		editor.commands.add( 'indentList', new IndentCommand( editor, 'forward' ) );
		editor.commands.add( 'outdentList', new IndentCommand( editor, 'backward' ) );
		const viewDocument = editing.view.document;
		// Overwrite default Enter key behavior.
		// If Enter key is pressed with selection collapsed in empty list item, outdent it instead of breaking it.
		this.listenTo( viewDocument, 'enter', ( evt, data ) => {
			const doc = this.editor.model.document;
			const positionParent = doc.selection.getLastPosition().parent;
			if ( doc.selection.isCollapsed && positionParent.name == 'descriptionlistItem' && positionParent.isEmpty ) {
				this.editor.execute( 'outdentList' );
				data.preventDefault();
				evt.stop();
			}
		}, { context: 'dd' } );
		// Overwrite default Backspace key behavior.
		// If Backspace key is pressed with selection collapsed on first position in first list item, outdent it. #83
		this.listenTo( viewDocument, 'delete', ( evt, data ) => {
			// Check conditions from those that require less computations like those immediately available.
			if ( data.direction !== 'backward' ) {
				return;
			}
			const selection = this.editor.model.document.selection;
			if ( !selection.isCollapsed ) {
				return;
			}
			const firstPosition = selection.getFirstPosition();
			if ( !firstPosition.isAtStart ) {
				return;
			}
			const positionParent = firstPosition.parent;
			if ( positionParent.name !== 'descriptionlistItem' ) {
				return;
			}
			const previousIsAListItem = positionParent.previousSibling && positionParent.previousSibling.name === 'descriptionlistItem';
			if ( previousIsAListItem ) {
				return;
			}
			this.editor.execute( 'outdentList' );
			data.preventDefault();
			evt.stop();
		}, { context: 'dd' } );
		this.listenTo( editor.editing.view.document, 'tab', ( evt, data ) => {
			const commandName = data.shiftKey ? 'outdentList' : 'indentList';
			const command = this.editor.commands.get( commandName );
			if ( command.isEnabled ) {
				editor.execute( commandName );
				data.stopPropagation();
				data.preventDefault();
				evt.stop();
			}
		}, { context: 'dd' } );
	}

	/**
	 * @inheritDoc
	 */
	afterInit() {
		const commands = this.editor.commands;
		const indent = commands.get( 'indent' );
		if ( indent ) {
			indent.registerChildCommand( commands.get( 'indentList' ) );
		}
		const outdent = commands.get( 'outdent' );
		if ( outdent ) {
			indent.registerChildCommand( commands.get( 'outdentList' ) );
		}
	}
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
