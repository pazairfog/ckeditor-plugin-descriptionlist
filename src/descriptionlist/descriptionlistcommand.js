/**
 * @module descriptionlist/descriptionlistcommand
 */

import { Command } from 'ckeditor5/src/core';
import { first } from 'ckeditor5/src/utils';

/**
 * The description list command.
 */
export default class DescriptionListCommand extends Command {
	/**
	 * Creates an instance of the command.
	 *
	 * @param {module:core/editor/editor~Editor} editor The editor instance.
	 * @param {'dl'|'dd'|'dt'} type List type that will be handled by this command.
	 */
	constructor( editor, type ) {
		super( editor );
		this.type = type;
	}

	/**
	 * @inheritDoc
	 */
	refresh() {
		this.value = this._getValue();
		this.isEnabled = this._checkEnabled();
	}

	/**
	 * Executes the descriptionlist command.
	 *
	 * @fires execute
   * @param options Command options.
   * @param options.forceValue If set, it will force the command behavior. If `true`, the command will try to convert the
   * selected items and potentially the neighbor elements to the proper list items. If set to `false`, it will convert selected elements
   * to paragraphs. If not set, the command will toggle selected elements to list items or paragraphs, depending on the selection.
	 */
	execute( options = {} ) {
		const model = this.editor.model;
		const document = model.document;
		const blocks = Array.from( document.selection.getSelectedBlocks() )
			.filter( block => checkCanBecomeListItem( block, model.schema ) );
		// Whether we are turning off some items.
		const turnOff = options.forceValue !== undefined ? !options.forceValue : this.value;

		model.change( writer => {
			for ( const element of blocks.reverse() ) {
				if ( turnOff && element.name == 'descriptionlistItem' ) {
					// We are turning off and the element is a `listItem` - it should be converted to `paragraph`.
					// List item specific attributes are removed by post fixer.
					writer.rename( element, 'paragraph' );
				}
				else if ( element.name != 'descriptionlistItem' ) {
					// We are turning on and the element is not a `descriptionlistItem` - it should be converted to `descriptionlistItem`.
					// The order of operations is important to keep model in correct state.
					writer.setAttributes( { listType: this.type, listIndent: 0 }, element );
					writer.rename( element, 'descriptionlistItem' );
				}
				else if ( element.name == 'descriptionlistItem' && element.getAttribute( 'listType' ) != this.type ) {
					// We are turning on and the element is a `descriptionlistItem` but has different type - change it's type and
					// type of it's all siblings that have same indent.
					writer.setAttribute( 'listType', this.type, element );
				}
			}
		} );
	}

	/**
	 * Checks the command's {@link #value}.
	 *
	 * @returns The current value.
	 */
	_getValue() {
		// Check whether closest `descriptionlistItem` ancestor of the position has a correct type.
		const listItem = first( this.editor.model.document.selection.getSelectedBlocks() );
		return !!listItem && listItem.is( 'element', 'descriptionlistItem' ) && listItem.getAttribute( 'listType' ) == this.type;
	}

	/**
	 * Checks whether the command can be enabled in the current context.
	 *
	 * @returns Whether the command should be enabled.
	 */
	_checkEnabled() {
		// If command value is true it means that we are in list item, so the command should be enabled.
		if ( this.value ) {
			return true;
		}
		const selection = this.editor.model.document.selection;
		const schema = this.editor.model.schema;
		const firstBlock = first( selection.getSelectedBlocks() );
		if ( !firstBlock ) {
			return false;
		}
		// Otherwise, check if list item can be inserted at the position start.
		return checkCanBecomeListItem( firstBlock, schema );
	}
}

/**
 * Checks whether the given block can be replaced by a descriptionlistItem.
 *
 * @param block A block to be tested.
 * @param schema The schema of the document.
 */
function checkCanBecomeListItem( block, schema ) {
	return schema.checkChild( block.parent, 'descriptionlistItem' ) && !schema.isObject( block );
}
