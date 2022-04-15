/**
 * @module descriptionlist/descriptionlist
 */

import DescriptionListEditing from './descriptionlist/descriptionlistediting';
import DescriptionListUI from './descriptionlist/descriptionlistui';
import { Plugin } from 'ckeditor5/src/core';

/**
 * The descriptionlist feature.
 *
 * @extends module:core/plugin~Plugin
 */
export default class DescriptionList extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get requires() {
		return [ DescriptionListEditing, DescriptionListUI ];
	}

	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'DescriptionList';
	}
}
