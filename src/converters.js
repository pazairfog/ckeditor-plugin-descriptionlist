import { TreeWalker } from 'ckeditor5/src/engine';

import {
	generateItemInDl,
	injectViewList,
	mergeViewLists,
	getSiblingListItem,
	positionAfterUiElements
} from './utils';

/**
 * A model-to-view converter for the `descriptionListItem` model element insertion.
 *
 * @see module:engine/conversion/downcastdispatcher~DowncastDispatcher#event:insert
 * @param {module:engine/model/model~Model} model Model instance.
 * @param {'dd'|'dt'} type List type that will be handled by this command.
 * @returns {Function} Returns a conversion callback.
 */
export function modelViewInsertion( model, type ) {
	return ( evt, data, conversionApi ) => {
		const consumable = conversionApi.consumable;

		if ( !consumable.test( data.item, 'insert' ) ||
			!consumable.test( data.item, 'attribute:listType' ) ||
			!consumable.test( data.item, 'attribute:listIndent' )
		) {
			return;
		}

		consumable.consume( data.item, 'insert' );
		consumable.consume( data.item, 'attribute:listType' );
		consumable.consume( data.item, 'attribute:listIndent' );

		const modelItem = data.item;
		const viewItem = generateItemInDl( modelItem, conversionApi, type );

		injectViewList( modelItem, viewItem, conversionApi, model );
	};
}

/**
 * A model-to-view converter for the `descriptionListItem` model element removal.
 *
 * @see module:engine/conversion/downcastdispatcher~DowncastDispatcher#event:remove
 * @param {module:engine/model/model~Model} model Model instance.
 * @returns {Function} Returns a conversion callback.
 */
export function modelViewRemove( model ) {
	return ( evt, data, conversionApi ) => {
		const viewPosition = conversionApi.mapper.toViewPosition( data.position );
		const viewStart = viewPosition.getLastMatchingPosition( value => !value.item.is( 'element', 'dd' ) );
		const viewItem = viewStart.nodeAfter;
		const viewWriter = conversionApi.writer;

		// 1. Break the container after and before the list item.
		// This will create a view list with one view list item - the one to remove.
		viewWriter.breakContainer( viewWriter.createPositionBefore( viewItem ) );
		viewWriter.breakContainer( viewWriter.createPositionAfter( viewItem ) );

		// 2. Remove the list with the item to remove.
		const viewList = viewItem.parent;
		const viewListPrev = viewList.previousSibling;
		const removeRange = viewWriter.createRangeOn( viewList );
		const removed = viewWriter.remove( removeRange );

		// 3. Merge the whole created by breaking and removing the list.
		if ( viewListPrev && viewListPrev.nextSibling ) {
			mergeViewLists( viewWriter, viewListPrev, viewListPrev.nextSibling );
		}

		// 4. Bring back nested list that was in the removed <dl>.
		const modelItem = conversionApi.mapper.toModelElement( viewItem );

		hoistNestedLists( modelItem.getAttribute( 'listIndent' ) + 1, data.position, removeRange.start, viewItem, conversionApi, model );

		// 5. Unbind removed view item and all children.
		for ( const child of viewWriter.createRangeIn( removed ).getItems() ) {
			conversionApi.mapper.unbindViewElement( child );
		}

		evt.stop();
	};
}

/**
 * A model-to-view converter for the `type` attribute change on the `descriptionListItem` model element.
 *
 * Splitting this conversion into 2 steps makes it possible to add an additional conversion in the middle.
 * Check {@link module:list/todolistconverters~modelViewChangeType} to see an example of it.
 *
 * @see module:engine/conversion/downcastdispatcher~DowncastDispatcher#event:attribute
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data Additional information about the change.
 * @param {module:engine/conversion/downcastdispatcher~DowncastConversionApi} conversionApi Conversion interface.
 */
export function modelViewChangeType( evt, data, conversionApi ) {
	if ( !conversionApi.consumable.consume( data.item, 'attribute:listType' ) ) {
		return;
	}

	const viewItem = conversionApi.mapper.toViewElement( data.item );
	const viewWriter = conversionApi.writer;

	// Break the container after and before the list item.
	// This will create a view list with one view list item -- the one that changed type.
	viewWriter.breakContainer( viewWriter.createPositionBefore( viewItem ) );
	viewWriter.breakContainer( viewWriter.createPositionAfter( viewItem ) );

	// Change name of the view list that holds the changed view item.
	// We cannot just change name property, because that would not render properly.
	const viewList = viewItem.parent;
	const listName = 'dl';

	viewWriter.rename( listName, viewList );
}

/**
 * A model-to-view converter that attempts to merge nodes split by {@link module:list/converters~modelViewChangeType}.
 *
 * @see module:engine/conversion/downcastdispatcher~DowncastDispatcher#event:attribute
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data Additional information about the change.
 * @param {module:engine/conversion/downcastdispatcher~DowncastConversionApi} conversionApi Conversion interface.
 */
export function modelViewMergeAfterChangeType( evt, data, conversionApi ) {
	const viewItem = conversionApi.mapper.toViewElement( data.item );
	const viewList = viewItem.parent;
	const viewWriter = conversionApi.writer;

	// Merge the changed view list with other lists, if possible.
	mergeViewLists( viewWriter, viewList, viewList.nextSibling );
	mergeViewLists( viewWriter, viewList.previousSibling, viewList );

	// Consumable insertion of children inside the item. They are already handled by re-building the item in view.
	for ( const child of data.item.getChildren() ) {
		conversionApi.consumable.consume( child, 'insert' );
	}
}

/**
 * A special model-to-view converter introduced by the {@link module:list/list~List list feature}. This converter is fired for
 * insert change of every model item, and should be fired before the actual converter. The converter checks whether the inserted
 * model item is a non-`descriptionListItem` element. If it is, and it is inserted inside a view list, the converter breaks the
 * list so the model element is inserted to the view parent element corresponding to its model parent element.
 *
 * @see module:engine/conversion/downcastdispatcher~DowncastDispatcher#event:insert
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data Additional information about the change.
 * @param {module:engine/conversion/downcastdispatcher~DowncastConversionApi} conversionApi Conversion interface.
 */
export function modelViewSplitOnInsert( evt, data, conversionApi ) {
	if ( data.item.name != 'descriptionListItem' ) {
		let viewPosition = conversionApi.mapper.toViewPosition( data.range.start );

		const viewWriter = conversionApi.writer;
		const lists = [];
		while ( viewPosition.parent.name == 'dl' ) {
			viewPosition = viewWriter.breakContainer( viewPosition );

			if ( viewPosition.parent.name != 'dd' && viewPosition.parent.name != 'dt' ) {
				break;
			}

			// Remove lists that are after inserted element.
			// They will be brought back later, below the inserted element.
			const removeStart = viewPosition;
			const removeEnd = viewWriter.createPositionAt( viewPosition.parent, 'end' );

			// Don't remove if there is nothing to remove.
			if ( !removeStart.isEqual( removeEnd ) ) {
				const removed = viewWriter.remove( viewWriter.createRange( removeStart, removeEnd ) );
				lists.push( removed );
			}

			viewPosition = viewWriter.createPositionAfter( viewPosition.parent );
		}

		// Bring back removed lists.
		if ( lists.length > 0 ) {
			for ( let i = 0; i < lists.length; i++ ) {
				const previousList = viewPosition.nodeBefore;
				const insertedRange = viewWriter.insert( viewPosition, lists[ i ] );
				viewPosition = insertedRange.end;

				// Don't merge first list! We want a split in that place (this is why this converter is introduced).
				if ( i > 0 ) {
					const mergePos = mergeViewLists( viewWriter, previousList, previousList.nextSibling );

					// If `mergePos` is in `previousList` it means that the lists got merged.
					// In this case, we need to fix insert position.
					if ( mergePos && mergePos.parent == previousList ) {
						viewPosition.offset--;
					}
				}
			}

			// Merge last inserted list with element after it.
			mergeViewLists( viewWriter, viewPosition.nodeBefore, viewPosition.nodeAfter );
		}
	}
}

/**
 * A special model-to-view converter introduced by the {@link module:list/list~List list feature}. This converter takes care of
 * merging view lists after something is removed or moved from near them.
 *
 * @see module:engine/conversion/downcastdispatcher~DowncastDispatcher#event:remove
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data Additional information about the change.
 * @param {module:engine/conversion/downcastdispatcher~DowncastConversionApi} conversionApi Conversion interface.
 */
export function modelViewMergeAfter( evt, data, conversionApi ) {
	const viewPosition = conversionApi.mapper.toViewPosition( data.position );
	const viewItemPrev = viewPosition.nodeBefore;
	const viewItemNext = viewPosition.nodeAfter;

	// Merge lists if something (remove, move) was done from inside of list.
	// Merging will be done only if both items are view lists of the same type.
	// The check is done inside the helper function.
	mergeViewLists( conversionApi.writer, viewItemPrev, viewItemNext );
}

/**
 * A view-to-model converter that converts the `<dl>` view elements into the `descriptionListItem` model elements.
 *
 * To set correct values of the `listType` and `listIndent` attributes the converter:
 * * checks `<dl>`'s parent,
 * * stores and increases the `conversionApi.store.indent` value when `<dl>`'s sub-items are converted.
 *
 * @see module:engine/conversion/upcastdispatcher~UpcastDispatcher#event:element
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data An object containing conversion input and a placeholder for conversion output and possibly other values.
 * @param {module:engine/conversion/upcastdispatcher~UpcastConversionApi} conversionApi Conversion interface to be used by the callback.
 */
export function viewModelConverter( evt, data, conversionApi ) {
	if ( conversionApi.consumable.consume( data.viewItem, { name: true } ) ) {
		const writer = conversionApi.writer;

		// 1. Create `descriptionListItem` model element.
		const descriptionListItem = writer.createElement( 'descriptionListItem' );

		// 2. Handle `descriptionListItem` model element attributes.
		const indent = getIndent( data.viewItem );

		writer.setAttribute( 'listIndent', indent, descriptionListItem );

		writer.setAttribute( 'listType', 'dd', descriptionListItem );

		if ( !conversionApi.safeInsert( descriptionListItem, data.modelCursor ) ) {
			return;
		}

		const nextPosition = viewToModelListItemChildrenConverter( descriptionListItem, data.viewItem.getChildren(), conversionApi );

		// Result range starts before the first item and ends after the last.
		data.modelRange = writer.createRange( data.modelCursor, nextPosition );

		conversionApi.updateConversionResult( descriptionListItem, data );
	}
}

/**
 * A view-to-model converter for the `<dl>` view elements that cleans the input view of garbage.
 * This is mostly to clean whitespaces from between the `<dl>` view elements inside the view list element, however, also
 * incorrect data can be cleared if the view was incorrect.
 *
 * @see module:engine/conversion/upcastdispatcher~UpcastDispatcher#event:element
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data An object containing conversion input and a placeholder for conversion output and possibly other values.
 * @param {module:engine/conversion/upcastdispatcher~UpcastConversionApi} conversionApi Conversion interface to be used by the callback.
 */
export function cleanList( evt, data, conversionApi ) {
	if ( conversionApi.consumable.test( data.viewItem, { name: true } ) ) {
		// Caching children because when we start removing them iterating fails.
		const children = Array.from( data.viewItem.getChildren() );

		for ( const child of children ) {
			const isWrongElement = !( child.is( 'element', 'dd' ) || isList( child ) );

			if ( isWrongElement ) {
				child._remove();
			}
		}
	}
}

/**
 * A view-to-model converter for the `<dl>` elements that cleans whitespace formatting from the input view.
 *
 * @see module:engine/conversion/upcastdispatcher~UpcastDispatcher#event:element
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Object} data An object containing conversion input and a placeholder for conversion output and possibly other values.
 * @param {module:engine/conversion/upcastdispatcher~UpcastConversionApi} conversionApi Conversion interface to be used by the callback.
 */
export function cleanListItem( evt, data, conversionApi ) {
	if ( conversionApi.consumable.test( data.viewItem, { name: true } ) ) {
		if ( data.viewItem.childCount === 0 ) {
			return;
		}

		const children = [ ...data.viewItem.getChildren() ];

		let foundList = false;

		for ( const child of children ) {
			if ( foundList && !isList( child ) ) {
				child._remove();
			}

			if ( isList( child ) ) {
				// If this is a <dl>, do not process it, just mark that we already visited list element.
				foundList = true;
			}
		}
	}
}

/**
 * Returns a callback for model position to view position mapping for {@link module:engine/conversion/mapper~Mapper}.
 * The callback fixes positions between the `descriptionListItem` elements that would be incorrectly mapped
 * because of how list items are represented in the model and in the view.
 *
 * @see module:engine/conversion/mapper~Mapper#event:modelToViewPosition
 * @param {module:engine/view/view~View} view A view instance.
 * @returns {Function}
 */
export function modelToViewPosition( view ) {
	return ( evt, data ) => {
		if ( data.isPhantom ) {
			return;
		}

		const modelItem = data.modelPosition.nodeBefore;

		if ( modelItem && modelItem.is( 'element', 'descriptionListItem' ) ) {
			const viewItem = data.mapper.toViewElement( modelItem );
			const topmostViewList = viewItem.getAncestors().find( isList );
			const walker = view.createPositionAt( viewItem, 0 ).getWalker();

			for ( const value of walker ) {
				if ( value.type == 'elementStart' && value.item.is( 'element', 'dd' ) ) {
					data.viewPosition = value.previousPosition;

					break;
				} else if ( value.type == 'elementEnd' && value.item == topmostViewList ) {
					data.viewPosition = value.nextPosition;

					break;
				}
			}
		}
	};
}

/**
 * The callback for view position to model position mapping for {@link module:engine/conversion/mapper~Mapper}.
 *
 * @see module:engine/conversion/mapper~Mapper#event:viewToModelPosition
 * @param {module:engine/model/model~Model} model Model instance.
 * @returns {Function} Returns a conversion callback.
 */
export function viewToModelPosition( model ) {
	return ( evt, data ) => {
		const viewPos = data.viewPosition;
		const viewParent = viewPos.parent;
		const mapper = data.mapper;

		if ( !viewParent ) {
			return;
		}

		if ( viewParent.name == 'dl' ) {
			if ( !viewPos.isAtEnd ) {
				// If position is not at the end, it must be before <dl>.
				// Get that <dl>, map it to `descriptionListItem` and set model position before that `descriptionListItem`.
				const modelNode = mapper.toModelElement( viewPos.nodeAfter );

				data.modelPosition = model.createPositionBefore( modelNode );
			} else {
				// Position is at the end of <dl>, so there is no <dl> after it to be mapped.
				// There is <dl> before the position, but we cannot just map it to `descriptionListItem` and set model position after it,
				// because that <dl> may contain nested items.
				// We will check "model length" of that <dl>, in other words - how many `descriptionListItem`s are in that <dl>.
				const modelNode = mapper.toModelElement( viewPos.nodeBefore );
				const modelLength = mapper.getModelLength( viewPos.nodeBefore );

				// Then we get model position before mapped `descriptionListItem` and shift it accordingly.
				data.modelPosition = model.createPositionBefore( modelNode ).getShiftedBy( modelLength );
			}

			evt.stop();
		} else if (
			( viewParent.name == 'dd' || viewParent.name == 'dt' ) &&
			viewPos.nodeBefore &&
			( viewPos.nodeBefore.name == 'dl' )
		) {
			// In most cases when view position is in <dl> it is in text and this is a correct position.
			// However, if position is after <dl> we have to fix it -- because in model <dl> are not in the `descriptionListItem`.
			const modelNode = mapper.toModelElement( viewParent );

			// Check all <dl>s that are in the <dl> but before mapped position.
			// Get model length of those elements and then add it to the offset of `descriptionListItem` mapped to the original <dl>.
			let modelLength = 1; // Starts from 1 because the original <dl> has to be counted in too.
			let viewList = viewPos.nodeBefore;

			while ( viewList && isList( viewList ) ) {
				modelLength += mapper.getModelLength( viewList );

				viewList = viewList.previousSibling;
			}

			data.modelPosition = model.createPositionBefore( modelNode ).getShiftedBy( modelLength );

			evt.stop();
		}
	};
}

/**
 * Post-fixer that reacts to changes on document and fixes incorrect model states.
 *
 * @param {module:engine/model/model~Model} model The data model.
 * @param {module:engine/model/writer~Writer} writer The writer to do changes with.
 * @returns {Boolean} `true` if any change has been applied, `false` otherwise.
 */
export function modelChangePostFixerTODO( model, writer ) {
	const changes = model.document.differ.getChanges();

	console.log( 'modelChangePostFixer', writer ); // eslint-disable-line
	console.log( 'modelChangePostFixer', changes ); // eslint-disable-line

	return false;
}

/**
 * Post-fixer that reacts to changes on document and fixes incorrect model states.
 *
 * @param {module:engine/model/model~Model} model The data model.
 * @param {module:engine/model/writer~Writer} writer The writer to do changes with.
 * @returns {Boolean} `true` if any change has been applied, `false` otherwise.
 */
export function modelChangePostFixer( model, writer ) {
	const changes = model.document.differ.getChanges();
	const itemToListHead = new Map();

	let applied = false;

	for ( const entry of changes ) {
		if ( entry.type == 'insert' && entry.name == 'descriptionListItem' ) {
			_addListToFix( entry.position );
		} else if ( entry.type == 'insert' && entry.name != 'descriptionListItem' ) {
			if ( entry.name != '$text' ) {
				// In case of renamed element.
				const item = entry.position.nodeAfter;

				if ( item.hasAttribute( 'listIndent' ) ) {
					writer.removeAttribute( 'listIndent', item );

					applied = true;
				}

				if ( item.hasAttribute( 'listType' ) ) {
					writer.removeAttribute( 'listType', item );

					applied = true;
				}

				if ( item.hasAttribute( 'listStyle' ) ) {
					writer.removeAttribute( 'listStyle', item );

					applied = true;
				}

				if ( item.hasAttribute( 'listReversed' ) ) {
					writer.removeAttribute( 'listReversed', item );

					applied = true;
				}

				if ( item.hasAttribute( 'listStart' ) ) {
					writer.removeAttribute( 'listStart', item );

					applied = true;
				}

				const items = Array.from( model.createRangeIn( item ) ).filter( e => e.item.is( 'element', 'descriptionListItem' ) );
				for ( const innerItem of items ) {
					_addListToFix( innerItem.previousPosition );
				}
			}

			const posAfter = entry.position.getShiftedBy( entry.length );

			_addListToFix( posAfter );
		} else if ( entry.type == 'remove' && entry.name == 'descriptionListItem' ) {
			_addListToFix( entry.position );
		} else if ( entry.type == 'attribute' && entry.attributeKey == 'listIndent' ) {
			_addListToFix( entry.range.start );
		} else if ( entry.type == 'attribute' && entry.attributeKey == 'listType' ) {
			_addListToFix( entry.range.start );
		}
	}

	for ( const listHead of itemToListHead.values() ) {
		_fixListIndents( listHead );
		_fixListTypes( listHead );
	}

	return applied;

	function _addListToFix( position ) {
		const previousNode = position.nodeBefore;

		if ( !previousNode || !previousNode.is( 'element', 'descriptionListItem' ) ) {
			const item = position.nodeAfter;

			if ( item && item.is( 'element', 'descriptionListItem' ) ) {
				itemToListHead.set( item, item );
			}
		} else {
			let listHead = previousNode;

			if ( itemToListHead.has( listHead ) ) {
				return;
			}

			for (
				// Cache previousSibling and reuse for performance reasons. See #6581.
				let previousSibling = listHead.previousSibling;
				previousSibling && previousSibling.is( 'element', 'descriptionListItem' );
				previousSibling = listHead.previousSibling
			) {
				listHead = previousSibling;

				if ( itemToListHead.has( listHead ) ) {
					return;
				}
			}

			itemToListHead.set( previousNode, listHead );
		}
	}

	function _fixListIndents( item ) {
		let maxIndent = 0;
		let fixBy = null;

		while ( item && item.is( 'element', 'descriptionListItem' ) ) {
			const itemIndent = item.getAttribute( 'listIndent' );

			if ( itemIndent > maxIndent ) {
				let newIndent;

				if ( fixBy === null ) {
					fixBy = itemIndent - maxIndent;
					newIndent = maxIndent;
				} else {
					if ( fixBy > itemIndent ) {
						fixBy = itemIndent;
					}

					newIndent = itemIndent - fixBy;
				}

				writer.setAttribute( 'listIndent', newIndent, item );

				applied = true;
			} else {
				fixBy = null;
				maxIndent = item.getAttribute( 'listIndent' ) + 1;
			}

			item = item.nextSibling;
		}
	}

	function _fixListTypes( item ) {
		let typesStack = [];
		let prev = null;

		while ( item && item.is( 'element', 'descriptionListItem' ) ) {
			const itemIndent = item.getAttribute( 'listIndent' );

			if ( prev && prev.getAttribute( 'listIndent' ) > itemIndent ) {
				typesStack = typesStack.slice( 0, itemIndent + 1 );
			}

			if ( itemIndent != 0 ) {
				if ( typesStack[ itemIndent ] ) {
					const type = typesStack[ itemIndent ];

					if ( item.getAttribute( 'listType' ) != type ) {
						writer.setAttribute( 'listType', type, item );

						applied = true;
					}
				} else {
					typesStack[ itemIndent ] = item.getAttribute( 'listType' );
				}
			}

			prev = item;
			item = item.nextSibling;
		}
	}
}

/**
 * A fixer for pasted content that includes list items.
 *
 * It fixes indentation of pasted list items so the pasted items match correctly to the context they are pasted into.
 *
 * Example:
 *
 *		<descriptionListItem listType="dl">A</descriptionListItem>
 *		<descriptionListItem listType="dl">B^</descriptionListItem>
 *		// At ^ paste:  <descriptionListItem listType="dl">X</descriptionListItem>
 *		//              <descriptionListItem listType="dl">Y</descriptionListItem>
 *		<descriptionListItem listType="dl">C</descriptionListItem>
 *
 * Should become:
 *
 *		<descriptionListItem listType="dl">A</descriptionListItem>
 *		<descriptionListItem listType="dl">BX</descriptionListItem>
 *		<descriptionListItem listType="dl">Y/descriptionListItem>
 *		<descriptionListItem listType="dl">C</descriptionListItem>
 *
 * @param {module:utils/eventinfo~EventInfo} evt An object containing information about the fired event.
 * @param {Array} args Arguments of {@link module:engine/model/model~Model#insertContent}.
 */
export function modelIndentPasteFixer( evt, [ content, selectable ] ) {
	// Check whether inserted content starts from a `descriptionListItem`. If it does not, it means that there are some other
	// elements before it and there is no need to fix indents, because even if we insert that content into a list,
	// that list will be broken.
	// Note: we also need to handle singular elements because inserting item with indent 0 into 0,1,[],2
	// would create incorrect model.
	let item = content.is( 'documentFragment' ) ? content.getChild( 0 ) : content;

	let selection;

	if ( !selectable ) {
		selection = this.document.selection;
	} else {
		selection = this.createSelection( selectable );
	}

	if ( item && item.is( 'element', 'descriptionListItem' ) ) {
		// Get a reference list item. Inserted list items will be fixed according to that item.
		const pos = selection.getFirstPosition();
		let refItem = null;

		if ( pos.parent.is( 'element', 'descriptionListItem' ) ) {
			refItem = pos.parent;
		} else if ( pos.nodeBefore && pos.nodeBefore.is( 'element', 'descriptionListItem' ) ) {
			refItem = pos.nodeBefore;
		}

		// If there is `refItem` it means that we do insert list items into an existing list.
		if ( refItem ) {
			// First list item in `data` has indent equal to 0 (it is a first list item). It should have indent equal
			// to the indent of reference item. We have to fix the first item and all of it's children and following siblings.
			// Indent of all those items has to be adjusted to reference item.
			const indentChange = refItem.getAttribute( 'listIndent' );

			// Fix only if there is anything to fix.
			if ( indentChange > 0 ) {
				// Adjust indent of all "first" list items in inserted data.
				while ( item && item.is( 'element', 'descriptionListItem' ) ) {
					item._setAttribute( 'listIndent', item.getAttribute( 'listIndent' ) + indentChange );

					item = item.nextSibling;
				}
			}
		}
	}
}

// Helper function that converts children of a given `<dl>` view element into corresponding model elements.
// The function maintains proper order of elements if model `descriptionListItem` is split during the conversion
// due to block children conversion.
//
// @param {module:engine/model/element~Element} listItemModel List item model element to which converted children will be inserted.
// @param {Iterable.<module:engine/view/node~Node>} viewChildren View elements which will be converted.
// @param {module:engine/conversion/upcastdispatcher~UpcastConversionApi} conversionApi Conversion interface to be used by the callback.
// @returns {module:engine/model/position~Position} Position on which next elements should be inserted after children conversion.
function viewToModelListItemChildrenConverter( listItemModel, viewChildren, conversionApi ) {
	const { writer, schema } = conversionApi;

	// A position after the last inserted `descriptionListItem`.
	let nextPosition = writer.createPositionAfter( listItemModel );

	// At this point we assume there are no "whitespace" view text nodes
	// in view list, between view list items. This should be handled by `<dl>` converters.
	for ( const child of viewChildren ) {
		if ( child.name == 'dl' ) {
			// If the children is a list, we will insert its conversion result after currently handled `descriptionListItem`.
			// Then, next insertion position will be set after all the new list items (and maybe other elements if
			// something split list item).
			//
			// If this is a list, we expect that some `descriptionListItem`s and possibly
			// other blocks will be inserted, however `.modelCursor` should be set after
			// last `descriptionListItem` (or block). This is why it feels safe to use it as `nextPosition`.
			nextPosition = conversionApi.convertItem( child, nextPosition ).modelCursor;
		} else {
			// If this is not a list, try inserting content at the end of the currently handled `descriptionListItem`.
			const result = conversionApi.convertItem( child, writer.createPositionAt( listItemModel, 'end' ) );

			const convertedChild = result.modelRange.start.nodeAfter;
			const wasSplit = convertedChild && convertedChild.is( 'element' ) && !schema.checkChild( listItemModel, convertedChild.name );

			if ( wasSplit ) {
				if ( result.modelCursor.parent.is( 'element', 'descriptionListItem' ) ) {
					// (1).
					listItemModel = result.modelCursor.parent;
				} else {
					// (2), (3).
					listItemModel = findNextListItem( result.modelCursor );
				}

				nextPosition = writer.createPositionAfter( listItemModel );
			}
		}
	}

	return nextPosition;
}

// Helper function that seeks for a next list item starting from given `startPosition`.
function findNextListItem( startPosition ) {
	const treeWalker = new TreeWalker( { startPosition } );

	let value;

	do {
		value = treeWalker.next();
	} while ( !value.value.item.is( 'element', 'descriptionListItem' ) );

	return value.value.item;
}

// Helper function that takes all children of given `viewRemovedItem` and moves them in a correct place, according
// to other given parameters.
function hoistNestedLists( nextIndent, modelRemoveStartPosition, viewRemoveStartPosition, viewRemovedItem, conversionApi, model ) {
	// Find correct previous model list item element.
	// The element has to have either same or smaller indent than given reference indent.
	// This will be the model element which will get nested items (if it has smaller indent) or sibling items (if it has same indent).
	// Keep in mind that such element might not be found, if removed item was the first item.
	const prevModelItem = getSiblingListItem( modelRemoveStartPosition.nodeBefore, {
		sameIndent: true,
		smallerIndent: true,
		listIndent: nextIndent,
		foo: 'b'
	} );

	const mapper = conversionApi.mapper;
	const viewWriter = conversionApi.writer;

	// Indent of found element or `null` if the element has not been found.
	const prevIndent = prevModelItem ? prevModelItem.getAttribute( 'listIndent' ) : null;

	let insertPosition;

	if ( !prevModelItem ) {
		// If element has not been found, simply insert lists at the position where the removed item was:
		//
		// Lorem ipsum.
		// 1 --------           <--- this is removed, no previous list item, put nested items in place of removed item.
		//   1.1 --------       <--- this is reference indent.
		//     1.1.1 --------
		//     1.1.2 --------
		//   1.2 --------
		//
		// Becomes:
		//
		// Lorem ipsum.
		// 1.1 --------
		//   1.1.1 --------
		//   1.1.2 --------
		// 1.2 --------
		insertPosition = viewRemoveStartPosition;
	} else if ( prevIndent == nextIndent ) {
		// If element has been found and has same indent as reference indent it means that nested items should
		// become siblings of found element:
		//
		// 1 --------
		//   1.1 --------
		//   1.2 --------       <--- this is `prevModelItem`.
		// 2 --------           <--- this is removed, previous list item has indent same as reference indent.
		//   2.1 --------       <--- this is reference indent, this and 2.2 should become siblings of 1.2.
		//   2.2 --------
		//
		// Becomes:
		//
		// 1 --------
		//   1.1 --------
		//   1.2 --------
		//   2.1 --------
		//   2.2 --------
		const prevViewList = mapper.toViewElement( prevModelItem ).parent;
		insertPosition = viewWriter.createPositionAfter( prevViewList );
	} else {
		// If element has been found and has smaller indent as reference indent it means that nested items
		// should become nested items of found item:
		//
		// 1 --------           <--- this is `prevModelItem`.
		//   1.1 --------       <--- this is removed, previous list item has indent smaller than reference indent.
		//     1.1.1 --------   <--- this is reference indent, this and 1.1.1 should become nested items of 1.
		//     1.1.2 --------
		//   1.2 --------
		//
		// Becomes:
		//
		// 1 --------
		//   1.1.1 --------
		//   1.1.2 --------
		//   1.2 --------
		//
		// Note: in this case 1.1.1 have indent 2 while 1 have indent 0. In model that should not be possible,
		// because following item may have indent bigger only by one. But this is fixed by postfixer.
		const modelPosition = model.createPositionAt( prevModelItem, 'end' );
		insertPosition = mapper.toViewPosition( modelPosition );
	}

	insertPosition = positionAfterUiElements( insertPosition );

	// Handle multiple lists. This happens if list item has nested numbered and bulleted lists. Following lists
	// are inserted after the first list (no need to recalculate insertion position for them).
	for ( const child of [ ...viewRemovedItem.getChildren() ] ) {
		if ( isList( child ) ) {
			insertPosition = viewWriter.move( viewWriter.createRangeOn( child ), insertPosition ).end;

			mergeViewLists( viewWriter, child, child.nextSibling );
			mergeViewLists( viewWriter, child.previousSibling, child );
		}
	}
}

// Checks if view element is a list type (dl).
//
// @param {module:engine/view/element~Element} viewElement
// @returns {Boolean}
function isList( viewElement ) {
	return viewElement.is( 'element', 'dl' );
}

// Calculates the indent value for a list item. Handles HTML compliant and non-compliant lists.
//
// Also, fixes non HTML compliant lists indents:
//
//		before:                                     fixed list:
//		OL                                          OL
//		|-> LI (parent LIs: 0)                      |-> LI     (indent: 0)
//		    |-> OL                                  |-> OL
//		        |-> OL                                  |
//		        |   |-> OL                              |
//		        |       |-> OL                          |
//		        |           |-> LI (parent LIs: 1)      |-> LI (indent: 1)
//		        |-> LI (parent LIs: 1)                  |-> LI (indent: 1)
//
//		before:                                     fixed list:
//		OL                                          OL
//		|-> OL                                      |
//		    |-> OL                                  |
//		         |-> OL                             |
//		             |-> LI (parent LIs: 0)         |-> LI        (indent: 0)
//
//		before:                                     fixed list:
//		OL                                          OL
//		|-> LI (parent LIs: 0)                      |-> LI         (indent: 0)
//		|-> OL                                          |-> OL
//		    |-> LI (parent LIs: 0)                          |-> LI (indent: 1)
//
// @param {module:engine/view/element~Element} descriptionListItem
// @param {Object} conversionStore
// @returns {Number}
function getIndent( descriptionListItem ) {
	let indent = 0;

	let parent = descriptionListItem.parent;

	while ( parent ) {
		// Each LI in the tree will result in an increased indent for HTML compliant lists.
		if ( parent.is( 'element', 'dd' ) || parent.is( 'element', 'dt' ) ) {
			indent++;
		} else {
			// If however the list is nested in other list we should check previous sibling of any of the list elements...
			const previousSibling = parent.previousSibling;

			// ...because the we might need increase its indent:
			//		before:                           fixed list:
			//		OL                                OL
			//		|-> LI (parent LIs: 0)            |-> LI         (indent: 0)
			//		|-> OL                                |-> OL
			//		    |-> LI (parent LIs: 0)                |-> LI (indent: 1)
			if ( previousSibling && previousSibling.is( 'element', 'dd' ) ) {
				indent++;
			}
		}

		parent = parent.parent;
	}

	return indent;
}
