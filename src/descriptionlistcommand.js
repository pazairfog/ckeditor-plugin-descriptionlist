/**
 * @module descriptionlist/descriptionlistcommand
 */

import { Command } from 'ckeditor5/src/core';

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

		/**
		 * The type of the list created by the command.
		 *
		 * @readonly
		 * @member {'dl'|'dd'|'dt'}
		 */
		this.type = type;
	}

	/**
	 * Executes the list command.
	 *
	 * @fires execute
	 */
	execute() {
		const model = this.editor.model;
		const blocks = Array.from( model.document.selection.getSelectedBlocks() );

		model.change( writer => {
			for ( const element of blocks.reverse() ) {
				console.log( this.type, element ); // eslint-disable-line
				if ( element.name != 'descriptionListItem' ) {
					// We are turning on and the element is not a `descriptionListItem` - it should be converted to `descriptionListItem`.
					// The order of operations is important to keep model in correct state.
					writer.setAttributes( { listType: this.type }, element );
					// @TODO Element name not created yet !
					// writer.rename( element, 'descriptionListItem' );
				}
				else if ( element.name == 'descriptionListItem' && element.getAttribute( 'listType' ) != this.type ) {
					// We are turning on and the element is a `descriptionListItem` but has different type - change it's type and
					// type of it's all siblings that have same indent.
					writer.setAttribute( 'listType', this.type, element );
				}
			}
		} );
	}
}
