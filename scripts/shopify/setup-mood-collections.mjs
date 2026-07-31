#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_VERSION = '2026-07';
const REQUIRED_ENV = ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'];
const MOOD_METAFIELD = {
  ownerType: 'PRODUCT',
  namespace: 'custom',
  key: 'mood',
  expectedType: 'list.single_line_text_field',
};

const MOOD_COLLECTIONS = [
  { title: 'Everyday Shine', handle: 'everyday-shine', create: false },
  { title: 'Color Ritual', handle: 'color-ritual', create: true },
  { title: 'Gift Ready', handle: 'gift-ready', create: true },
  { title: 'Evening Polish', handle: 'evening-polish', create: true },
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--apply');

class GraphqlResponseError extends Error {
  constructor(errors) {
    super(`GraphQL errors: ${JSON.stringify(errors)}`);
    this.name = 'GraphqlResponseError';
    this.errors = errors;
  }
}

function readDotEnv(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing .env file at ${filePath}`);
  }

  const env = {};
  const content = readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  for (const key of REQUIRED_ENV) {
    if (!env[key]) {
      throw new Error(`Missing ${key} in .env`);
    }
  }

  return env;
}

function normalizeShopDomain(shop) {
  const normalized = shop
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.myshopify\.com$/i, '');

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalized)) {
    throw new Error('SHOPIFY_SHOP must be a myshopify subdomain or domain.');
  }

  return `${normalized}.myshopify.com`;
}

function redact(message, values) {
  let output = String(message);
  for (const value of values) {
    if (value) output = output.split(value).join('[redacted]');
  }
  return output;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { rawBody: text };
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
    error.response = json;
    throw error;
  }

  return json;
}

async function authenticate({ shopDomain, clientId, clientSecret }) {
  const tokenUrl = `https://${shopDomain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { rawBody: text };
  }

  if (!response.ok || !json.access_token) {
    throw new Error(`Authentication failed: HTTP ${response.status}: ${JSON.stringify(json)}`);
  }

  return {
    accessToken: json.access_token,
    scope: json.scope || '',
    expiresIn: json.expires_in,
  };
}

function graphqlClient({ shopDomain, accessToken }) {
  const endpoint = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  return async function graphql(query, variables = {}) {
    const json = await postJson(
      endpoint,
      { query, variables },
      { 'x-shopify-access-token': accessToken },
    );

    if (json.errors?.length) {
      throw new GraphqlResponseError(json.errors);
    }

    return json.data;
  };
}

function isAccessDenied(error) {
  return (
    error instanceof GraphqlResponseError &&
    error.errors.some((item) => item.extensions?.code === 'ACCESS_DENIED')
  );
}

async function getShopAndScopes(graphql) {
  const data = await graphql(`
    query CandyBeadShopIdentity {
      shop {
        id
        name
        myshopifyDomain
      }
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }
  `);

  return {
    shop: data.shop,
    scopes: data.currentAppInstallation?.accessScopes?.map((scope) => scope.handle) || [],
  };
}

async function getMoodMetafieldDefinition(graphql) {
  const data = await graphql(
    `
      query CandyBeadMoodMetafieldDefinition(
        $ownerType: MetafieldOwnerType!
        $namespace: String!
      ) {
        metafieldDefinitions(first: 250, ownerType: $ownerType, namespace: $namespace) {
          nodes {
            id
            name
            namespace
            key
            ownerType
            type {
              name
              category
            }
          }
        }
      }
    `,
    {
      ownerType: MOOD_METAFIELD.ownerType,
      namespace: MOOD_METAFIELD.namespace,
    },
  );

  return data.metafieldDefinitions.nodes.find(
    (definition) =>
      definition.namespace === MOOD_METAFIELD.namespace && definition.key === MOOD_METAFIELD.key,
  );
}

async function getCollectionByHandle(graphql, handle) {
  const data = await graphql(
    `
      query CandyBeadCollectionByHandle($query: String!) {
        collections(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            updatedAt
          }
        }
      }
    `,
    { query: `handle:${handle}` },
  );

  return data.collections.nodes.find((collection) => collection.handle === handle) || null;
}

async function getSchemaEvidence(graphql) {
  const data = await graphql(
    `
      query CandyBeadCollectionConditionSchema {
        collectionCreateInput: __type(name: "CollectionCreateInput") {
          ...SchemaType
        }
        collectionCreateSourceTargetInput: __type(name: "CollectionCreateSourceTargetInput") {
          ...SchemaType
        }
        collectionCreateConditionsSourceInput: __type(name: "CollectionCreateConditionsSourceInput") {
          ...SchemaType
        }
        collectionCreateSourceInclusionInput: __type(name: "CollectionCreateSourceInclusionInput") {
          ...SchemaType
        }
        collectionSourceInclusionConditionInput: __type(name: "CollectionSourceInclusionConditionInput") {
          ...SchemaType
        }
        collectionSourceInclusionConditionMetafieldStringListInput: __type(
          name: "CollectionSourceInclusionConditionMetafieldStringListInput"
        ) {
          ...SchemaType
        }
        collectionSourceInclusionConditionMetafieldStringListRelation: __type(
          name: "CollectionSourceInclusionConditionMetafieldStringListRelation"
        ) {
          ...SchemaType
        }
        collectionConditionMatchType: __type(name: "CollectionConditionMatchType") {
          ...SchemaType
        }
      }

      fragment SchemaType on __Type {
        name
        kind
        inputFields {
          name
        }
        enumValues {
          name
        }
      }
    `,
  );

  const selected = new Map();
  for (const type of Object.values(data)) {
    if (type?.name) {
      selected.set(type.name, {
        kind: type.kind,
        inputFields: type.inputFields?.map((field) => field.name) || [],
        enumValues: type.enumValues?.map((field) => field.name) || [],
      });
    }
  }

  assertSchemaShape(selected);
  return selected;
}

function assertSchemaShape(schema) {
  const requiredShape = [
    ['CollectionCreateInput', 'sources'],
    ['CollectionCreateSourceTargetInput', 'source'],
    ['CollectionCreateConditionsSourceInput', 'inclusion'],
    ['CollectionCreateSourceInclusionInput', 'conditions'],
    ['CollectionSourceInclusionConditionInput', 'metafieldStringList'],
    ['CollectionSourceInclusionConditionMetafieldStringListInput', 'definitionId'],
    ['CollectionSourceInclusionConditionMetafieldStringListInput', 'relation'],
    ['CollectionSourceInclusionConditionMetafieldStringListInput', 'values'],
    ['CollectionSourceInclusionConditionMetafieldStringListInput', 'matchType'],
  ];

  for (const [typeName, fieldName] of requiredShape) {
    const type = schema.get(typeName);
    if (!type?.inputFields.includes(fieldName)) {
      throw new Error(`GraphQL schema mismatch: ${typeName}.${fieldName} was not found.`);
    }
  }

  const relation = schema.get('CollectionSourceInclusionConditionMetafieldStringListRelation');
  if (!relation?.enumValues.includes('INCLUDES')) {
    throw new Error('GraphQL schema mismatch: metafield string-list relation INCLUDES was not found.');
  }

  const matchType = schema.get('CollectionConditionMatchType');
  if (!matchType?.enumValues.includes('ALL') || !matchType.enumValues.includes('ANY')) {
    throw new Error('GraphQL schema mismatch: collection match types ALL/ANY were not found.');
  }
}

function buildCollectionInput({ title, handle, metafieldDefinitionId }) {
  return {
    title,
    handle,
    sources: [
      {
        source: {
          title: `Mood: ${title}`,
          inclusion: {
            matchType: 'ALL',
            conditions: [
              {
                metafieldStringList: {
                  definitionId: metafieldDefinitionId,
                  relation: 'INCLUDES',
                  values: [title],
                  matchType: 'ANY',
                },
              },
            ],
          },
        },
      },
    ],
  };
}

async function createCollection(graphql, collectionInput) {
  const data = await graphql(
    `
      mutation CandyBeadCreateMoodCollection($collection: CollectionCreateInput!) {
        collectionCreate(collection: $collection) {
          collection {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { collection: collectionInput },
  );

  const payload = data.collectionCreate;
  if (payload.userErrors?.length) {
    throw new Error(`collectionCreate userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  return payload.collection;
}

function formatStatus(status, mood) {
  if (status?.collection) return `${mood.title}: FOUND (${status.collection.handle})`;
  if (status?.accessDenied) return `${mood.title}: UNKNOWN -> access denied`;
  if (mood.create) {
    return `${mood.title}: MISSING -> ${dryRun ? 'would create' : 'creating'}`;
  }
  return `${mood.title}: MISSING -> skipped`;
}

async function main() {
  const envPath = resolve(process.cwd(), '.env');
  const env = readDotEnv(envPath);
  const shopDomain = normalizeShopDomain(env.SHOPIFY_SHOP);
  const auth = await authenticate({
    shopDomain,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
  });
  const graphql = graphqlClient({ shopDomain, accessToken: auth.accessToken });

  const [{ shop, scopes }, definition] = await Promise.all([
    getShopAndScopes(graphql),
    getMoodMetafieldDefinition(graphql),
  ]);
  await getSchemaEvidence(graphql);

  const collections = new Map();
  let collectionAccessDenied = false;
  for (const mood of MOOD_COLLECTIONS) {
    try {
      collections.set(mood.handle, {
        collection: await getCollectionByHandle(graphql, mood.handle),
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      collectionAccessDenied = true;
      collections.set(mood.handle, { accessDenied: true });
    }
  }

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`API version: ${API_VERSION}`);
  console.log(`Authentication: OK`);
  console.log(`Shop: ${shop.name} (${shop.myshopifyDomain})`);
  console.log(`Granted scopes: ${scopes.join(', ') || auth.scope || '(none reported)'}`);

  const metafieldReady = definition?.type?.name === MOOD_METAFIELD.expectedType;

  if (definition) {
    console.log(`Mood metafield: FOUND (${definition.namespace}.${definition.key})`);
    console.log(`Mood metafield type: ${definition.type.name}`);
  } else {
    console.log(`Mood metafield: MISSING or not visible with current API scopes`);
  }

  for (const mood of MOOD_COLLECTIONS) {
    console.log(formatStatus(collections.get(mood.handle), mood));
  }

  const exampleMood = MOOD_COLLECTIONS.find((mood) => mood.create);
  const exampleRule = buildCollectionInput({
    title: exampleMood.title,
    handle: exampleMood.handle,
    metafieldDefinitionId: definition?.id || 'gid://shopify/MetafieldDefinition/<custom.mood-definition-id>',
  }).sources[0].source.inclusion.conditions[0];

  console.log('Rule structure verified from GraphQL schema:');
  console.log(JSON.stringify(exampleRule, null, 2));

  if (!definition) {
    console.log('Prerequisite check: FAILED -> custom.mood metafield definition was not found or is not visible.');
  } else if (!metafieldReady) {
    console.log(
      `Prerequisite check: FAILED -> custom.mood type is ${definition.type.name}; expected ${MOOD_METAFIELD.expectedType}.`,
    );
  }

  if (collectionAccessDenied) {
    console.log('Collection status query: ACCESS_DENIED');
    console.log('No collection mutations will be attempted without collection read access.');
  }

  if (dryRun) {
    console.log('No Shopify data changed.');
    return;
  }

  if (!definition) {
    throw new Error('Cannot build collection rules because custom.mood metafield definition was not found.');
  }

  if (!metafieldReady) {
    throw new Error(
      `custom.mood has type ${definition.type.name}; expected ${MOOD_METAFIELD.expectedType}.`,
    );
  }

  if (collectionAccessDenied) {
    throw new Error('Cannot safely create idempotent collections because existing collection status is unknown.');
  }

  for (const mood of MOOD_COLLECTIONS) {
    if (!mood.create || collections.get(mood.handle)?.collection) continue;

    const collectionInput = buildCollectionInput({
      title: mood.title,
      handle: mood.handle,
      metafieldDefinitionId: definition.id,
    });
    const created = await createCollection(graphql, collectionInput);
    console.log(`${mood.title}: CREATED (${created.handle})`);
  }
}

main().catch((error) => {
  const env = existsSync('.env') ? readDotEnv(resolve(process.cwd(), '.env')) : {};
  const redacted = redact(error.message, [
    env.SHOPIFY_CLIENT_SECRET,
    env.SHOPIFY_CLIENT_ID,
  ]);
  console.error(redacted);
  process.exitCode = 1;
});
