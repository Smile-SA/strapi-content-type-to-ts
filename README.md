# strapi-content-type-to-ts

[![NPM version](https://img.shields.io/npm/v/@smile/strapi-content-type-to-ts)](https://www.npmjs.com/package/@smile/strapi-content-type-to-ts)

A script to generate TypeScript types (intended to be used for API calls) from Strapi content types schemas.

## Usage

In your strapi project.

### Add the dependency:

```shell
npm i -D @smile/strapi-content-type-to-ts
```

### Add a script in your `package.json`

```json
...
"scripts": {
  ...
  "generate-content-types": "strapi-content-type-to-ts --out ./strapi-content-types.ts"
}
...
```

The `strapi-content-type-to-ts` script has several possible configurations:

| Configuration                                     | Description                                                           | Default value           |
|---------------------------------------------------|-----------------------------------------------------------------------|-------------------------|
| `--out <file>`                                    | Output file in which TypeScript types will be written                 | stdout                  |
| `--strapi-root-directory <path>`                  | Path to Strapi root directory                                         | `.` (current directory) |
| `--custom-fields-extension-directory <directory>` | Path to the directory containing custom fields extensions (see below) | `custom-field`          |

### Run the script

Run `npm run generate-content-types` and check the generated file: `strapi-content-types.ts`.

### Handling custom fields

If your Strapi has custom fields (via plugins), it won't be handled natively by this script.
It'll default to an `any` type with a `FIXME` in the generated types to remember you that you should handle it with a plugin.
Also, executing the script will log errors of the form:
```text
Missing custom field plugin for [customField].
Create a [pathToTheCustomFieldPlugin] file with the following signature:
module.exports = function (options) {
  return '...';
}
```

Here are some examples

#### [ckeditor5.CKEditor](https://github.com/nshenderov/strapi-plugin-ckeditor) plugin

File `custom-field/ckeditor5.CKEditor.js`:
```javascript
module.exports = function (options) {
  return 'string';
}
```

#### [multi-select.multi-select](https://github.com/Zaydme/strapi-plugin-multi-select) plugin

File `custom-field/multi-select.multi-select.js`:
```javascript
/**
 * If options param is of the form ["label1","label2:value2","label3"] the code returns: (`label1` | `value2` | `label3`)[]
 */
module.exports = function (options) {
  return `(${options.map(v => {
    const [label, value] = v.split(':');
    return `\`${value || label}\``;
  }).join(' | ')})[]`;
}
```
