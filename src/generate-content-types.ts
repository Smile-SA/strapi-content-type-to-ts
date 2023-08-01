import * as fs from 'fs';
import * as path from 'path';
import {globSync} from 'glob';
import {program} from 'commander';
import {ContentTypeSchema} from '@strapi/strapi/lib/types/core/schemas';
import {Attribute, AttributeType, BasicRelationsType} from '@strapi/strapi';
import {RequiredOption} from '@strapi/strapi/lib/types/core/attributes/base';
import {RelationAttribute} from '@strapi/strapi/lib/types/core/attributes/relation';
import {AllowedMediaTypes, MediaAttribute} from '@strapi/strapi/lib/types/core/attributes/media';
import {ComponentAttribute} from '@strapi/strapi/lib/types/core/attributes/component';
import {EnumerationAttribute} from '@strapi/strapi/lib/types/core/attributes/enumeration';
import {DynamicZoneAttribute} from '@strapi/strapi/lib/types/core/attributes/dynamic-zone';
import {CustomField} from '@strapi/strapi/lib/types/core/attributes/common';

program
    .addHelpText('before', 'Script that will generate TypeScript types (intended to be used for API calls) from Strapi content types schemas.')
    .option('-s, --strapi-root-directory <path>', 'Path to Strapi root directory', '.')
    .option('-e, --custom-fields-extension-directory <directory>', 'Path to the directory containing custom fields extensions', 'custom-field')
    .option('-o, --out <file>', 'Output file in which TypeScript types will be written. If not set, prints on stdout.')
    .parse();

const options = program.opts();
const srcPath = getSrcPath();
const customFieldsExtensionDirectory = options.customFieldsExtensionDirectory as string;
const outFile = options.out ? fs.createWriteStream(options.out) : undefined;
const apiFiles = getApiFiles();
const componentsFiles = getComponentsFiles();

(async () => {
    for (const file of [...apiFiles, ...componentsFiles]) {
        const schema: ContentTypeSchema = JSON.parse(fs.readFileSync(file).toString());

        const [_, strapiComponentCategory, strapiComponentName] = /components\/([^\/]*)\/(.*)\.json/.exec(file) || [];

        const isComponent = strapiComponentCategory && strapiComponentName;
        const interfaceName = schema.info.singularName
            ? toComponentType(schema.info.singularName)
            : isComponent
                ? `${capitalizeFirstLetter(strapiComponentCategory)}${toComponentType(strapiComponentName)}`
                : console.error(`Unexpected schema: ${file}`);
        const __componentProperty = isComponent ? `  __component?: '${strapiComponentCategory}.${strapiComponentName}'\n` : '';
        const properties = (await Promise.all(Object.entries(schema.attributes).map(async ([propertyName, schemaAttribute]) => {
            const required = (schemaAttribute as RequiredOption)['required'];
            const propertyType = await getPropertyType(schemaAttribute);
            return `  ${propertyName}${required ? '' : '?'}: ${propertyType!};`;
        })));

        const code = `\
export interface ${interfaceName} {
${__componentProperty}\
${properties.join('\n')}
}\n\n`;

        outFile ? outFile.write(code) : process.stdout.write(code);
    }
})();

/**
 * Computes the property type from the Strapi schema attribute.
 * It handles every native types and can handle custom fields by developing extensions.
 * @param schemaAttribute
 */
async function getPropertyType(schemaAttribute: Attribute): Promise<string> {
    switch (schemaAttribute.type as AttributeType | 'customField') {
        case 'integer':
        case 'decimal':
        case 'biginteger':
        case 'float':
            return 'number';
        case 'string':
        case 'text':
        case 'email':
        case 'richtext':
        case 'password':
        case 'uid':
            return 'string';
        case 'date':
        case 'datetime':
        case 'time':
            return 'Date';
        case 'boolean':
            return 'boolean';
        case 'enumeration':
            const valueEnum = schemaAttribute as EnumerationAttribute<string[]>;
            const enumValues = valueEnum.enum;
            return `(${enumValues.map(v => `\`${v}\``).join(' | ')})`;
        case 'relation':
            const valueRelation = schemaAttribute as RelationAttribute<never, BasicRelationsType>;
            const many = ['oneToMany', 'manyToMany'].includes(valueRelation.relation);
            return many
                ? `number[] | { set: number[] | { id: number }[] } | { disconnect?: number[] | { id: number }[], connect?: number[] | { id: number, position?: { before?: number, after?: number, start?: boolean, end?: boolean } }[] }`
                : `number | { set: [number] | [{ id: number }] } | { disconnect?: [number] | [{ id: number }], connect?: [number] | [{ id: number, position?: { before?: number, after?: number, start?: boolean, end?: boolean } }] }`
                ;
        case 'media':
            const valueMedia = schemaAttribute as MediaAttribute<AllowedMediaTypes, boolean>;
            const multiple = valueMedia.multiple;
            return multiple ? '{ id: number }[]' : 'number';
        case 'component':
            const valueComponent = schemaAttribute as ComponentAttribute<Strapi.ComponentUIDs, boolean>;
            const componentType = toComponentType(valueComponent.component as string);
            const repeatable = valueComponent.repeatable;
            return `${componentType}${repeatable ? '[]' : ''}`;
        case 'json':
            return 'any';
        case 'dynamiczone':
            const valueDynamicZone = schemaAttribute as DynamicZoneAttribute<Strapi.ComponentUIDs[]>;
            const components = valueDynamicZone.components as string[];
            return `(${components.map(component => toComponentType(component)).join(' | ')})[]`;
        case 'customField':
            const valueCustomField = schemaAttribute as unknown as CustomField<string, any>;
            const customField = valueCustomField.customField.replace(/^plugin::/, '');
            const options = valueCustomField.options;

            const customFieldPluginPath = path.resolve(path.isAbsolute(customFieldsExtensionDirectory) ? customFieldsExtensionDirectory : path.resolve(process.cwd(), `./${customFieldsExtensionDirectory}`), `${customField}.js`);
            try {
                return (await import(customFieldPluginPath))(options);
            } catch (e) {
                console.error(`Missing custom field plugin for ${customField}.
Create a ${customFieldPluginPath} file with the following signature:
module.exports = function (options) {
  return '...';
}
          `)
                return `any //FIXME: missing custom field plugin for ${customField}`;
            }
        default:
            console.error(`Type not handled: ${schemaAttribute.type}`);
            return 'any';
    }
}

function notStrapiRootDirectoryError(e?: unknown) {
    console.error(`Directory ${path.resolve(options.strapiRootDirectory)} doesn't look like a Strapi root directory. Try to configure it with --strapi-root-directory <path>`, e);
    return process.exit(1);
}

function getSrcPath() {
    const srcPath = path.join(options.strapiRootDirectory, '/src') as string;
    if (!fs.existsSync(srcPath) || !fs.lstatSync(srcPath).isDirectory()) {
        return notStrapiRootDirectoryError();
    }
    return srcPath;
}

function getApiFiles(): string[] {
    try {
        const apiDir = path.resolve(path.join(srcPath, 'api'));
        return globSync('**/schema.json', {cwd: apiDir, absolute: true});
    } catch (e) {
        return notStrapiRootDirectoryError(e);
    }
}

function getComponentsFiles() {
    try {
        const componentsDir = path.resolve(path.join(srcPath, 'components'));
        return globSync('**/*.json', {cwd: componentsDir, absolute: true});
    } catch (e) {
        return notStrapiRootDirectoryError(e);
    }
}

function capitalizeFirstLetter(string?: string) {
    return string ? string.charAt(0).toUpperCase() + string.slice(1) : string;
}

function toComponentType(componentName: string | undefined) {
    return componentName ? componentName.split(/[.-]/)?.map(v => capitalizeFirstLetter(v))?.join('') : componentName;
}
