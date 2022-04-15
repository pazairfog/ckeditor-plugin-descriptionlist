import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import Heading from '@ckeditor/ckeditor5-heading/src/heading';
import ClassicEditor from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';
import DescriptionList from '../src/descriptionlist';

/* global document */

describe( 'DescriptionList', () => {
	it( 'should be named', () => {
		expect( DescriptionList.pluginName ).to.equal( 'DescriptionList' );
	} );

	describe( 'init()', () => {
		let domElement, editor;

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				plugins: [
					Paragraph,
					Heading,
					Essentials,
					DescriptionList
				],
				toolbar: [
					'descriptionList',
					'descriptionTerm',
					'descriptionValue'
				]
			} );
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		it( 'should load DescriptionList', () => {
			const myPlugin = editor.plugins.get( 'DescriptionList' );

			expect( myPlugin ).to.be.an.instanceof( DescriptionList );
		} );

		it( 'should add an icon to the toolbar', () => {
			expect( editor.ui.componentFactory.has( 'descriptionList' ) ).to.equal( true );
			expect( editor.ui.componentFactory.has( 'descriptionTerm' ) ).to.equal( true );
			expect( editor.ui.componentFactory.has( 'descriptionValue' ) ).to.equal( true );
		} );

		it( 'should add a <dl> wrapper into the editor after clicking the icon', () => {
			const icon = editor.ui.componentFactory.create( 'descriptionList' );

			expect( editor.getData() ).to.equal( '' );

			icon.fire( 'execute' );

			// eslint-disable-next-line no-undef
			console.log( editor.getData() );

			expect( editor.getData() ).to.equal( '<dl></dl>' );
		} );
	} );
} );
