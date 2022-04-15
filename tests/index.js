import { DescriptionList as DescriptionListDll, icons } from '../src';
import DescriptionList from '../src/descriptionlist';

import ckeditor from './../theme/icons/ckeditor.svg';

describe( 'CKEditor5 DescriptionList DLL', () => {
	it( 'exports DescriptionList', () => {
		expect( DescriptionListDll ).to.equal( DescriptionList );
	} );

	describe( 'icons', () => {
		it( 'exports the "ckeditor" icon', () => {
			expect( icons.ckeditor ).to.equal( ckeditor );
		} );
	} );
} );
