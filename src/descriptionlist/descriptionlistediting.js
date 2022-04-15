import { Plugin } from 'ckeditor5/src/core';
import { Enter } from 'ckeditor5/src/enter';
import { Delete } from 'ckeditor5/src/typing';
import ListIndentCommand from '@ckeditor/ckeditor5-list/src/list/listindentcommand';
import ListUtils from '@ckeditor/ckeditor5-list/src/list/listutils';
import ListSplitCommand from '@ckeditor/ckeditor5-list/src/list/listsplitcommand';
import { findAndAddListHeadToMap, fixListIndents, fixListItemIds } from '@ckeditor/ckeditor5-list/src/list/utils/postfixers';
import * as converters from '@ckeditor/ckeditor5-list/src/list/converters';
import { getSelectedBlockObject, isSingleListItem, isListItemBlock } from '@ckeditor/ckeditor5-list/src/list/utils/model';
import { getViewElementIdForListType, getViewElementNameForListType } from '@ckeditor/ckeditor5-list/src/list/utils/view';
import ListWalker, { ListBlocksIterable } from '@ckeditor/ckeditor5-list/src/list/utils/listwalker';

import DescriptionListCommand from './descriptionlistcommand';

/**
 * A list of base list model attributes.
 */
const LIST_BASE_ATTRIBUTES = [ 'listType', 'listIndent', 'listItemId' ];

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
		const model = editor.model;

		model.schema.register( '$listItem', { allowAttributes: LIST_BASE_ATTRIBUTES } );
		model.schema.register( 'listItem', {
			inheritAllFrom: '$block',
			allowAttributesOf: '$listItem'
		} );
		for ( const attribute of LIST_BASE_ATTRIBUTES ) {
			model.schema.setAttributeProperties( attribute, {
				copyOnReplace: true
			} );
		}

		// Register commands.
		editor.commands.add( 'descriptionList', new DescriptionListCommand( editor, 'dl' ) );
		editor.commands.add( 'descriptionTerm', new DescriptionListCommand( editor, 'dt' ) );
		editor.commands.add( 'descriptionValue', new DescriptionListCommand( editor, 'dd' ) );
		editor.commands.add( 'indentList', new ListIndentCommand( editor, 'forward' ) );
		editor.commands.add( 'outdentList', new ListIndentCommand( editor, 'backward' ) );
		editor.commands.add( 'splitListItemBefore', new ListSplitCommand( editor, 'before' ) );
		editor.commands.add( 'splitListItemAfter', new ListSplitCommand( editor, 'after' ) );

		this._setupDeleteIntegration();
		this._setupEnterIntegration();
		this._setupTabIntegration();
		this._setupAccessibilityIntegration();
	}

	/**
	 * @inheritDoc
	 */
	afterInit() {
		const editor = this.editor;
		const commands = editor.commands;
		const indent = commands.get( 'indent' );
		const outdent = commands.get( 'outdent' );
		if ( indent ) {
			// Priority is high due to integration with `IndentBlock` plugin. We want to indent list first and if it's not possible
			// user can indent content with `IndentBlock` plugin.
			indent.registerChildCommand( commands.get( 'indentList' ), { priority: 'high' } );
		}
		if ( outdent ) {
			// Priority is lowest due to integration with `IndentBlock` and `IndentCode` plugins.
			// First we want to allow user to outdent all indendations from other features then he can oudent list item.
			outdent.registerChildCommand( commands.get( 'outdentList' ), { priority: 'lowest' } );
		}
		// Register conversion and model post-fixer after other plugins had a chance to register their attribute strategies.
		this._setupModelPostFixing();
		this._setupConversion();
	}

	/**
	 * Registers a downcast strategy.
	 *
	 * **Note**: Strategies must be registered in the `Plugin#init()` phase so that it can be applied
	 * in the `ListEditing#afterInit()`.
	 *
	 * @param strategy The downcast strategy to register.
	 */
	registerDowncastStrategy( strategy ) {
		this._downcastStrategies.push( strategy );
	}

	/**
	 * Returns list of model attribute names that should affect downcast conversion.
	 */
	getListAttributeNames() {
		return [
			...LIST_BASE_ATTRIBUTES,
			...this._downcastStrategies.map( strategy => strategy.attributeName )
		];
	}

	/**
	 * Attaches the listener to the {@link module:engine/view/document~Document#event:delete} event and handles backspace/delete
	 * keys in and around document lists.
	 */
	_setupDeleteIntegration() {
		const editor = this.editor;
		const model = editor.model;
		const mergeBackwardCommand = editor.commands.get( 'mergeListItemBackward' );
		const mergeForwardCommand = editor.commands.get( 'mergeListItemForward' );
		this.listenTo( editor.editing.view.document, 'delete', ( evt, data ) => {
			const selection = editor.model.document.selection;
			// Let the Widget plugin take care of block widgets while deleting (https://github.com/ckeditor/ckeditor5/issues/11346).
			if ( model.getSelectedBlockObject( editor.model ) ) {
				return;
			}
			editor.model.change( () => {
				const firstPosition = selection.getFirstPosition();
				if ( selection.isCollapsed && data.direction == 'backward' ) {
					if ( !firstPosition.isAtStart ) {
						return;
					}
					const positionParent = firstPosition.parent;
					if ( !model.isListItemBlock( positionParent ) ) {
						return;
					}
					const previousBlock = ListWalker.first( positionParent, {
						sameAttributes: 'listType',
						sameIndent: true
					} );
					// Outdent the first block of a first list item.
					if ( !previousBlock && positionParent.getAttribute( 'listIndent' ) === 0 ) {
						if ( !model.isLastBlockOfListItem( positionParent ) ) {
							editor.execute( 'splitListItemAfter' );
						}
						editor.execute( 'outdentList' );
					}
					// Merge block with previous one (on the block level or on the content level).
					else {
						if ( !mergeBackwardCommand || !mergeBackwardCommand.isEnabled ) {
							return;
						}
						mergeBackwardCommand.execute( {
							shouldMergeOnBlocksContentLevel: shouldMergeOnBlocksContentLevel( editor.model, 'backward' )
						} );
					}
					data.preventDefault();
					evt.stop();
				}
				// Non-collapsed selection or forward delete.
				else {
					// Collapsed selection should trigger forward merging only if at the end of a block.
					if ( selection.isCollapsed && !selection.getLastPosition().isAtEnd ) {
						return;
					}
					if ( !mergeForwardCommand || !mergeForwardCommand.isEnabled ) {
						return;
					}
					mergeForwardCommand.execute( {
						shouldMergeOnBlocksContentLevel: shouldMergeOnBlocksContentLevel( editor.model, 'forward' )
					} );
					data.preventDefault();
					evt.stop();
				}
			} );
		}, { context: 'dd' } );
	}

	/**
	 * Attaches a listener to the {@link module:engine/view/document~Document#event:enter} event and handles enter key press
	 * in document lists.
	 */
	_setupEnterIntegration() {
		const editor = this.editor;
		const model = editor.model;
		const commands = editor.commands;
		const enterCommand = commands.get( 'enter' );
		// Overwrite the default Enter key behavior: outdent or split the list in certain cases.
		this.listenTo( editor.editing.view.document, 'enter', ( evt, data ) => {
			const doc = model.document;
			const positionParent = doc.selection.getFirstPosition().parent;
			if ( doc.selection.isCollapsed &&
				model.isListItemBlock( positionParent ) &&
				positionParent.isEmpty &&
				!data.isSoft ) {
				const isFirstBlock = model.isFirstBlockOfListItem( positionParent );
				const isLastBlock = model.isLastBlockOfListItem( positionParent );
				// * a      →      * a
				// * []     →      []
				if ( isFirstBlock && isLastBlock ) {
					editor.execute( 'outdentList' );
					data.preventDefault();
					evt.stop();
				}
				// * []     →      * []
				//   a      →      * a
				else if ( isFirstBlock && !isLastBlock ) {
					editor.execute( 'splitListItemAfter' );
					data.preventDefault();
					evt.stop();
				}
				// * a      →      * a
				//   []     →      * []
				else if ( isLastBlock ) {
					editor.execute( 'splitListItemBefore' );
					data.preventDefault();
					evt.stop();
				}
			}
		}, { context: 'dd' } );
		// In some cases, after the default block splitting, we want to modify the new block to become a new list item
		// instead of an additional block in the same list item.
		this.listenTo( enterCommand, 'afterExecute', () => {
			const splitCommand = commands.get( 'splitListItemBefore' );
			// The command has not refreshed because the change block related to EnterCommand#execute() is not over yet.
			// Let's keep it up to date and take advantage of ListSplitCommand#isEnabled.
			splitCommand.refresh();
			if ( !splitCommand.isEnabled ) {
				return;
			}
			const doc = editor.model.document;
			const positionParent = doc.selection.getLastPosition().parent;
			const listItemBlocks = model.getAllListItemBlocks( positionParent );
			// Keep in mind this split happens after the default enter handler was executed. For instance:
			//
			// │       Initial state       │    After default enter    │   Here in #afterExecute   │
			// ├───────────────────────────┼───────────────────────────┼───────────────────────────┤
			// │          * a[]            │           * a             │           * a             │
			// │                           │             []            │           * []            │
			if ( listItemBlocks.length === 2 ) {
				splitCommand.execute();
			}
		} );
	}

	/**
	 * Attaches a listener to the {@link module:engine/view/document~Document#event:tab} event and handles tab key and tab+shift keys
	 * presses in document lists.
	 */
	_setupTabIntegration() {
		const editor = this.editor;
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
	 * Registers the conversion helpers for the document-list feature.
	 */
	_setupConversion() {
		const editor = this.editor;
		const model = editor.model;
		const attributeNames = this.getListAttributeNames();
		const elementName = 'listItem';
		editor.conversion.for( 'upcast' )
			// Convert <dd> to a generic paragraph (or listItem element) so the content of <dd> is always inside a block.
			.elementToElement( {
				// @todo handle 'dt'.
				view: 'dd',
				model: ( viewElement, { writer } ) => writer.createElement( elementName, { listType: '' } )
			} )
			// Convert paragraph to the list block (without list type defined yet).
			// This is important to properly handle bogus paragraph and to-do lists.
			// Most of the time the bogus paragraph should not appear in the data of to-do list,
			// but if there is any marker or an attribute on the paragraph then the bogus paragraph
			// is preserved in the data, and we need to be able to detect this case.
			.elementToElement( {
				view: 'p',
				model: ( viewElement, { writer } ) => {
					if ( viewElement.parent && viewElement.parent.is( 'element', 'dd' ) ) {
						return writer.createElement( elementName, { listType: '' } );
					}
					return null;
				},
				converterPriority: 'high'
			} )
			.add( dispatcher => {
				dispatcher.on( 'element:dd', converters.listItemUpcastConverter() );
				dispatcher.on( 'element:dt', converters.listItemUpcastConverter() );
				dispatcher.on( 'element:dl', converters.listUpcastCleanList(), { priority: 'high' } );
			} );
		editor.conversion.for( 'downcast' )
			.elementToElement( {
				model: 'listItem',
				view: 'p'
			} );
		editor.conversion.for( 'editingDowncast' )
			.elementToElement( {
				model: elementName,
				view: converters.bogusParagraphCreator( attributeNames ),
				converterPriority: 'high'
			} )
			.add( dispatcher => {
				dispatcher.on( 'attribute', converters.listItemDowncastConverter( attributeNames, this._downcastStrategies, model ) );
				dispatcher.on( 'remove', converters.listItemDowncastRemoveConverter( model.schema ) );
			} );
		editor.conversion.for( 'dataDowncast' )
			.elementToElement( {
				model: elementName,
				view: converters.bogusParagraphCreator( attributeNames, { dataPipeline: true } ),
				converterPriority: 'high'
			} )
			.add( dispatcher => {
				dispatcher.on(
					'attribute',
					converters.listItemDowncastConverter( attributeNames, this._downcastStrategies, model, { dataPipeline: true } )
				);
			} );
		const modelToViewPositionMapper = converters.createModelToViewPositionMapper( this._downcastStrategies, editor.editing.view );
		editor.editing.mapper.on( 'modelToViewPosition', modelToViewPositionMapper );
		editor.data.mapper.on( 'modelToViewPosition', modelToViewPositionMapper );
		this.listenTo(
			model.document,
			'change:data',
			converters.reconvertItemsOnDataChange( model, editor.editing, attributeNames, this ),
			{ priority: 'high' }
		);
		// For LI verify if an ID of the attribute element is correct.
		this.on( 'checkAttributes:item', ( evt, { viewElement, modelAttributes } ) => {
			if ( viewElement.id != modelAttributes.listItemId ) {
				evt.return = true;
				evt.stop();
			}
		} );
		// For DL check if the name and ID of element is correct.
		this.on( 'checkAttributes:list', ( evt, { viewElement, modelAttributes } ) => {
			if ( viewElement.name != getViewElementNameForListType( modelAttributes.listType ) ||
				viewElement.id != getViewElementIdForListType( modelAttributes.listType, modelAttributes.listIndent ) ) {
				evt.return = true;
				evt.stop();
			}
		} );
	}

	/**
	 * Registers model post-fixers.
	 */
	_setupModelPostFixing() {
		const model = this.editor.model;
		const attributeNames = this.getListAttributeNames();
		// Register list fixing.
		// First the low level handler.
		model.document.registerPostFixer( writer => modelChangePostFixer( model, writer, attributeNames, this ) );
		// Then the callbacks for the specific lists.
		// The indentation fixing must be the first one...
		this.on( 'postFixer', ( evt, { listNodes, writer } ) => {
			evt.return = fixListIndents( listNodes, writer ) || evt.return;
		}, { priority: 'high' } );
		// ...then the item ids... and after that other fixers that rely on the correct indentation and ids.
		this.on( 'postFixer', ( evt, { listNodes, writer, seenIds } ) => {
			evt.return = fixListItemIds( listNodes, seenIds, writer ) || evt.return;
		}, { priority: 'high' } );
	}

	/**
	 * Informs editor accessibility features about keystrokes brought by the plugin.
	 */
	_setupAccessibilityIntegration() {
		const editor = this.editor;
		const t = editor.t;
		editor.accessibility.addKeystrokeInfoGroup( {
			id: 'list',
			label: t( 'Keystrokes that can be used in a list' ),
			keystrokes: [
				{
					label: t( 'Increase list item indent' ),
					keystroke: 'Tab'
				},
				{
					label: t( 'Decrease list item indent' ),
					keystroke: 'Shift+Tab'
				}
			]
		} );
	}
}

/**
 * Post-fixer that reacts to changes on document and fixes incorrect model states (invalid `listItemId` and `listIndent` values).
 *
 * @param model The data model.
 * @param writer The writer to do changes with.
 * @param attributeNames The list of all model list attributes (including registered strategies).
 * @param ListEditing The document list editing plugin.
 * @returns `true` if any change has been applied, `false` otherwise.
 */
function modelChangePostFixer( model, writer, attributeNames, listEditing ) {
	const changes = model.document.differ.getChanges();
	const itemToListHead = new Map();
	let applied = false;
	for ( const entry of changes ) {
		if ( entry.type == 'insert' && entry.name != '$text' ) {
			const item = entry.position.nodeAfter;
			// Remove attributes in case of renamed element.
			if ( !model.schema.checkAttribute( item, 'listItemId' ) ) {
				for ( const attributeName of Array.from( item.getAttributeKeys() ) ) {
					if ( attributeNames.includes( attributeName ) ) {
						writer.removeAttribute( attributeName, item );
						applied = true;
					}
				}
			}
			findAndAddListHeadToMap( entry.position, itemToListHead );
			// Insert of a non-list item - check if there is a list after it.
			if ( !entry.attributes.has( 'listItemId' ) ) {
				findAndAddListHeadToMap( entry.position.getShiftedBy( entry.length ), itemToListHead );
			}
			// Check if there is no nested list.
			for ( const { item: innerItem, previousPosition } of model.createRangeIn( item ) ) {
				if ( isListItemBlock( innerItem ) ) {
					findAndAddListHeadToMap( previousPosition, itemToListHead );
				}
			}
		}
		// Removed list item or block adjacent to a list.
		else if ( entry.type == 'remove' ) {
			findAndAddListHeadToMap( entry.position, itemToListHead );
		}
		// Changed list item indent or type.
		else if ( entry.type == 'attribute' && attributeNames.includes( entry.attributeKey ) ) {
			findAndAddListHeadToMap( entry.range.start, itemToListHead );
			if ( entry.attributeNewValue === null ) {
				findAndAddListHeadToMap( entry.range.start.getShiftedBy( 1 ), itemToListHead );
			}
		}
		// Make sure that there is no left over listItem element without attributes or a block with list attributes that is not a listItem.
		if ( entry.type == 'attribute' && LIST_BASE_ATTRIBUTES.includes( entry.attributeKey ) ) {
			const element = entry.range.start.nodeAfter;
			if ( entry.attributeNewValue === null && element && element.is( 'element', 'listItem' ) ) {
				writer.rename( element, 'paragraph' );
				applied = true;
			}
			else if ( entry.attributeOldValue === null && element && element.is( 'element' ) && element.name != 'listItem' ) {
				writer.rename( element, 'listItem' );
				applied = true;
			}
		}
	}
	// Make sure that IDs are not shared by split list.
	const seenIds = new Set();
	for ( const listHead of itemToListHead.values() ) {
		applied = listEditing.fire( 'postFixer', {
			listNodes: new ListBlocksIterable( listHead ),
			listHead,
			writer,
			seenIds
		} ) || applied;
	}
	return applied;
}

/**
 * Decides whether the merge should be accompanied by the model's `deleteContent()`, for instance, to get rid of the inline
 * content in the selection or take advantage of the heuristics in `deleteContent()` that helps convert lists into paragraphs
 * in certain cases.
 */
function shouldMergeOnBlocksContentLevel( model, direction ) {
	const selection = model.document.selection;
	if ( !selection.isCollapsed ) {
		return !getSelectedBlockObject( model );
	}
	if ( direction === 'forward' ) {
		return true;
	}
	const firstPosition = selection.getFirstPosition();
	const positionParent = firstPosition.parent;
	const previousSibling = positionParent.previousSibling;
	if ( model.schema.isObject( previousSibling ) ) {
		return false;
	}
	if ( previousSibling.isEmpty ) {
		return true;
	}
	return isSingleListItem( [ positionParent, previousSibling ] );
}
