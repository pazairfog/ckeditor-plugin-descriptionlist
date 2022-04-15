import { Plugin } from 'ckeditor5/src/core';
import { ButtonView } from 'ckeditor5/src/ui';

import descriptionListIcon from '../../theme/icons/descriptionlist.svg';
import descriptionTermIcon from '../../theme/icons/descriptionterm.svg';
import descriptionValueIcon from '../../theme/icons/descriptionvalue.svg';

/**
 * The description list UI feature.
 *
 * @extends module:core/plugin~Plugin
 */
export default class DescriptionListUI extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'DescriptionListUI';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const t = this.editor.t;

		createUIComponent( this.editor, 'descriptionList', t( 'Description List' ), descriptionListIcon );
		createUIComponent( this.editor, 'descriptionTerm', t( 'Description Term' ), descriptionTermIcon );
		createUIComponent( this.editor, 'descriptionValue', t( 'Description Value' ), descriptionValueIcon );
	}
}

/**
 * Helper method for creating a UI button and linking it to the appropriate command.
 *
 * @private
 * @param {module:core/editor/editor~Editor} editor The editor instance to which the UI component will be added.
 * @param {String} commandName The name of the command.
 * @param {String} label The button label.
 * @param {String} icon The source of the icon.
 */
export function createUIComponent( editor, commandName, label, icon ) {
	editor.ui.componentFactory.add( commandName, locale => {
		const command = editor.commands.get( commandName );
		const view = new ButtonView( locale );

		view.set( {
			label,
			icon,
			tooltip: true
		} );

		// Bind button model to command.
		view.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );

		view.on( 'execute', () => {
			editor.execute( commandName );
			editor.editing.view.focus();
		} );

		return view;
	} );
}
