#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_VERSION = '2026-07';
const REQUIRED_ENV = ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'];
const TARGET_PRODUCT_TYPE = 'Bracelet';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--apply');

const MOOD_COLLECTIONS = [
  { title: 'Everyday Shine', handle: 'everyday-shine' },
  { title: 'Color Ritual', handle: 'color-ritual' },
  { title: 'Gift Ready', handle: 'gift-ready' },
  { title: 'Evening Polish', handle: 'evening-polish' },
];

const SHOPPING_COLLECTIONS = [
  {
    title: 'New Arrivals',
    handle: 'new-arrivals',
    expectedCount: 1,
    condition: {
      productTag: {
        relation: 'TAGGED_WITH',
        values: ['new-arrival'],
        matchType: 'ANY',
      },
    },
  },
  {
    title: 'All Bracelets',
    handle: 'all-bracelets',
    expectedCount: 4,
    condition: {
      productType: {
        relation: 'EQUALS',
        values: [TARGET_PRODUCT_TYPE],
        matchType: 'ANY',
      },
    },
  },
  {
    title: 'Best Sellers',
    handle: 'best-sellers',
    sortOrder: 'BEST_SELLING',
    expectedCount: 4,
    condition: {
      productType: {
        relation: 'EQUALS',
        values: [TARGET_PRODUCT_TYPE],
        matchType: 'ANY',
      },
    },
  },
];

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

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function sameValues(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function conditionKey(condition) {
  if (condition.productTag) return 'productTag';
  if (condition.productType) return 'productType';
  throw new Error(`Unsupported condition: ${JSON.stringify(condition)}`);
}

function conditionTypename(condition) {
  const key = conditionKey(condition);
  if (key === 'productTag') return 'CollectionSourceInclusionConditionProductTag';
  if (key === 'productType') return 'CollectionSourceInclusionConditionProductType';
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

async function getSchemaEvidence(graphql) {
  const data = await graphql(`
    query CandyBeadMerchandisingSchema {
      mutation: __type(name: "Mutation") {
        fields {
          name
        }
      }
      productUpdateInput: __type(name: "ProductUpdateInput") {
        ...SchemaType
      }
      collectionCreateInput: __type(name: "CollectionCreateInput") {
        ...SchemaType
      }
      collectionUpdateInput: __type(name: "CollectionUpdateInput") {
        ...SchemaType
      }
      sourceTargetInput: __type(name: "CollectionCreateSourceTargetInput") {
        ...SchemaType
      }
      conditionInput: __type(name: "CollectionSourceInclusionConditionInput") {
        ...SchemaType
      }
      productTagInput: __type(name: "CollectionSourceInclusionConditionProductTagInput") {
        ...SchemaType
      }
      productTagRelation: __type(name: "CollectionSourceInclusionConditionProductTagRelation") {
        ...SchemaType
      }
      productTypeInput: __type(name: "CollectionSourceInclusionConditionProductTypeInput") {
        ...SchemaType
      }
      productTypeRelation: __type(name: "CollectionSourceInclusionConditionProductTypeRelation") {
        ...SchemaType
      }
      collectionSortOrder: __type(name: "CollectionSortOrder") {
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
  `);

  const mutations = data.mutation.fields.map((field) => field.name);
  if (!mutations.includes('productUpdate') || !mutations.includes('collectionCreate') || !mutations.includes('collectionUpdate')) {
    throw new Error('Required Shopify mutations were not found in the 2026-07 schema.');
  }

  const schema = new Map();
  for (const type of Object.values(data)) {
    if (!type?.name) continue;
    schema.set(type.name, {
      kind: type.kind,
      inputFields: type.inputFields?.map((field) => field.name) || [],
      enumValues: type.enumValues?.map((field) => field.name) || [],
    });
  }

  assertSchemaShape(schema);
}

function assertSchemaShape(schema) {
  const requiredFields = [
    ['ProductUpdateInput', 'id'],
    ['ProductUpdateInput', 'productType'],
    ['CollectionCreateInput', 'handle'],
    ['CollectionCreateInput', 'sources'],
    ['CollectionCreateInput', 'sortOrder'],
    ['CollectionUpdateInput', 'id'],
    ['CollectionUpdateInput', 'sortOrder'],
    ['CollectionUpdateInput', 'sourcesToCreate'],
    ['CollectionCreateSourceTargetInput', 'source'],
    ['CollectionSourceInclusionConditionInput', 'productTag'],
    ['CollectionSourceInclusionConditionInput', 'productType'],
    ['CollectionSourceInclusionConditionProductTagInput', 'relation'],
    ['CollectionSourceInclusionConditionProductTagInput', 'values'],
    ['CollectionSourceInclusionConditionProductTagInput', 'matchType'],
    ['CollectionSourceInclusionConditionProductTypeInput', 'relation'],
    ['CollectionSourceInclusionConditionProductTypeInput', 'values'],
    ['CollectionSourceInclusionConditionProductTypeInput', 'matchType'],
  ];

  for (const [typeName, fieldName] of requiredFields) {
    const type = schema.get(typeName);
    if (!type?.inputFields.includes(fieldName)) {
      throw new Error(`GraphQL schema mismatch: ${typeName}.${fieldName} was not found.`);
    }
  }

  if (!schema.get('CollectionSourceInclusionConditionProductTagRelation')?.enumValues.includes('TAGGED_WITH')) {
    throw new Error('GraphQL schema mismatch: product tag relation TAGGED_WITH was not found.');
  }

  if (!schema.get('CollectionSourceInclusionConditionProductTypeRelation')?.enumValues.includes('EQUALS')) {
    throw new Error('GraphQL schema mismatch: product type relation EQUALS was not found.');
  }

  if (!schema.get('CollectionSortOrder')?.enumValues.includes('BEST_SELLING')) {
    throw new Error('GraphQL schema mismatch: collection sort order BEST_SELLING was not found.');
  }

  const matchType = schema.get('CollectionConditionMatchType');
  if (!matchType?.enumValues.includes('ALL') || !matchType.enumValues.includes('ANY')) {
    throw new Error('GraphQL schema mismatch: collection match types ALL/ANY were not found.');
  }
}

async function getAllProducts(graphql) {
  const products = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await graphql(
      `
        query CandyBeadProducts($cursor: String) {
          products(first: 100, after: $cursor) {
            nodes {
              id
              title
              handle
              productType
              tags
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      { cursor },
    );

    products.push(...data.products.nodes);
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return products;
}

async function getProductById(graphql, id) {
  const data = await graphql(
    `
      query CandyBeadProductById($id: ID!) {
        product: node(id: $id) {
          ... on Product {
            id
            title
            handle
            productType
            tags
          }
        }
      }
    `,
    { id },
  );

  return data.product;
}

async function updateProductType(graphql, product) {
  const data = await graphql(
    `
      mutation CandyBeadUpdateProductType($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
            handle
            productType
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { product: { id: product.id, productType: TARGET_PRODUCT_TYPE } },
  );

  const payload = data.productUpdate;
  if (payload.userErrors?.length) {
    throw new Error(`productUpdate userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  return payload.product;
}

function collectionFields() {
  return `
    id
    title
    handle
    sortOrder
    productsCount {
      count
    }
    sources {
      __typename
      id
      title
      ... on CollectionConditionsSource {
        inclusion {
          matchType
          conditions {
            __typename
            id
            ... on CollectionSourceInclusionConditionProductTag {
              relation
              values
              matchType
            }
            ... on CollectionSourceInclusionConditionProductType {
              relation
              values
              matchType
            }
          }
        }
      }
    }
  `;
}

async function getCollectionByHandle(graphql, handle) {
  const data = await graphql(
    `
      query CandyBeadCollectionByHandle($query: String!) {
        collections(first: 1, query: $query) {
          nodes {
            ${collectionFields()}
          }
        }
      }
    `,
    { query: `handle:${handle}` },
  );

  return data.collections.nodes.find((collection) => collection.handle === handle) || null;
}

function buildSourceInput({ title, condition }) {
  return {
    source: {
      title: `Rule: ${title}`,
      inclusion: {
        matchType: 'ALL',
        conditions: [condition],
      },
    },
  };
}

function buildCollectionCreateInput(definition) {
  return {
    title: definition.title,
    handle: definition.handle,
    ...(definition.sortOrder ? { sortOrder: definition.sortOrder } : {}),
    sources: [buildSourceInput(definition)],
  };
}

function sourceMatchesCondition(source, desiredCondition) {
  const key = conditionKey(desiredCondition);
  const desired = desiredCondition[key];
  const desiredTypename = conditionTypename(desiredCondition);
  const conditions = source.inclusion?.conditions || [];

  return conditions.some((condition) => {
    return (
      condition.__typename === desiredTypename &&
      condition.relation === desired.relation &&
      condition.matchType === desired.matchType &&
      source.inclusion?.matchType === 'ALL' &&
      sameValues(condition.values || [], desired.values)
    );
  });
}

function collectionNeedsUpdate(collection, definition) {
  if (definition.sortOrder && collection.sortOrder !== definition.sortOrder) return true;
  return !collection.sources.some((source) => sourceMatchesCondition(source, definition.condition));
}

function buildCollectionUpdateInput(collection, definition) {
  const input = { id: collection.id };

  if (definition.sortOrder && collection.sortOrder !== definition.sortOrder) {
    input.sortOrder = definition.sortOrder;
  }

  if (!collection.sources.some((source) => sourceMatchesCondition(source, definition.condition))) {
    input.sourcesToCreate = [buildSourceInput(definition)];
  }

  return input;
}

async function createCollection(graphql, definition) {
  const data = await graphql(
    `
      mutation CandyBeadCreateShoppingCollection($collection: CollectionCreateInput!) {
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
    { collection: buildCollectionCreateInput(definition) },
  );

  const payload = data.collectionCreate;
  if (payload.userErrors?.length) {
    throw new Error(`collectionCreate userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  return payload.collection;
}

async function updateCollection(graphql, collection, definition) {
  const data = await graphql(
    `
      mutation CandyBeadUpdateShoppingCollection($collection: CollectionUpdateInput!) {
        collectionUpdate(collection: $collection) {
          collection {
            id
            title
            handle
            sortOrder
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { collection: buildCollectionUpdateInput(collection, definition) },
  );

  const payload = data.collectionUpdate;
  if (payload.userErrors?.length) {
    throw new Error(`collectionUpdate userErrors: ${JSON.stringify(payload.userErrors)}`);
  }

  return payload.collection;
}

function conditionSummary(definition) {
  const key = conditionKey(definition.condition);
  const condition = definition.condition[key];
  return `${key} ${condition.relation} ${JSON.stringify(condition.values)}, matchType ${condition.matchType}`;
}

async function readBackCollections(graphql) {
  const result = new Map();
  for (const definition of SHOPPING_COLLECTIONS) {
    result.set(definition.handle, await getCollectionByHandle(graphql, definition.handle));
  }
  return result;
}

async function pollCollections(graphql) {
  let collections = await readBackCollections(graphql);

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const countsReady = SHOPPING_COLLECTIONS.every((definition) => {
      const collection = collections.get(definition.handle);
      return collection?.productsCount?.count === definition.expectedCount;
    });

    if (countsReady) return collections;
    await delay(2500);
    collections = await readBackCollections(graphql);
  }

  return collections;
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

  const [{ shop, scopes }] = await Promise.all([getShopAndScopes(graphql), getSchemaEvidence(graphql)]);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`API version: ${API_VERSION}`);
  console.log(`Authentication: OK`);
  console.log(`Shop: ${shop.name} (${shop.myshopifyDomain})`);
  console.log(`Granted scopes: ${scopes.join(', ') || auth.scope || '(none reported)'}`);

  const initialProducts = await getAllProducts(graphql);
  console.log(`Products found: ${initialProducts.length}`);

  if (initialProducts.length !== 4) {
    throw new Error(`Expected 4 current products, found ${initialProducts.length}. Stopping before mutation.`);
  }

  const productUpdates = [];
  for (const product of initialProducts) {
    const currentProduct = await getProductById(graphql, product.id);
    if (!currentProduct) throw new Error(`Product disappeared before update: ${product.id}`);

    if (currentProduct.productType === TARGET_PRODUCT_TYPE) {
      console.log(`Product type OK: ${currentProduct.title} (${currentProduct.handle})`);
      continue;
    }

    if (dryRun) {
      console.log(`Product type MISSING/DIFFERENT -> would set Bracelet: ${currentProduct.title} (${currentProduct.handle})`);
      productUpdates.push({ before: currentProduct, after: null });
      continue;
    }

    const updated = await updateProductType(graphql, currentProduct);
    console.log(`Product type UPDATED: ${updated.title} (${updated.handle}) -> ${updated.productType}`);
    productUpdates.push({ before: currentProduct, after: updated });
  }

  console.log('Mood collections read-only check:');
  for (const definition of MOOD_COLLECTIONS) {
    const collection = await getCollectionByHandle(graphql, definition.handle);
    console.log(`- ${definition.title}: ${collection ? `FOUND (${collection.handle})` : 'MISSING'}`);
  }

  for (const definition of SHOPPING_COLLECTIONS) {
    const currentCollection = await getCollectionByHandle(graphql, definition.handle);

    if (!currentCollection) {
      if (dryRun) {
        console.log(`${definition.title}: MISSING -> would create (${conditionSummary(definition)})`);
        continue;
      }

      const created = await createCollection(graphql, definition);
      console.log(`${definition.title}: CREATED (${created.handle}, ${created.id})`);
      continue;
    }

    if (!collectionNeedsUpdate(currentCollection, definition)) {
      console.log(`${definition.title}: FOUND/OK (${currentCollection.handle}, ${currentCollection.id})`);
      continue;
    }

    if (dryRun) {
      console.log(`${definition.title}: FOUND -> would update (${conditionSummary(definition)})`);
      continue;
    }

    const latestCollection = await getCollectionByHandle(graphql, definition.handle);
    if (!latestCollection) {
      const created = await createCollection(graphql, definition);
      console.log(`${definition.title}: CREATED after re-query (${created.handle}, ${created.id})`);
      continue;
    }

    if (collectionNeedsUpdate(latestCollection, definition)) {
      const updated = await updateCollection(graphql, latestCollection, definition);
      console.log(`${definition.title}: UPDATED (${updated.handle}, ${updated.id})`);
    } else {
      console.log(`${definition.title}: FOUND/OK after re-query (${latestCollection.handle}, ${latestCollection.id})`);
    }
  }

  if (dryRun) {
    console.log('No Shopify data changed.');
    return;
  }

  const finalProducts = await getAllProducts(graphql);
  const finalCollections = await pollCollections(graphql);

  console.log('READ_BACK_PRODUCTS');
  for (const product of finalProducts) {
    console.log(
      JSON.stringify({
        title: product.title,
        id: product.id,
        handle: product.handle,
        productType: product.productType,
        tags: product.tags,
      }),
    );
  }

  console.log('READ_BACK_COLLECTIONS');
  for (const definition of SHOPPING_COLLECTIONS) {
    const collection = finalCollections.get(definition.handle);
    console.log(
      JSON.stringify({
        title: collection?.title,
        id: collection?.id,
        handle: collection?.handle,
        sortOrder: collection?.sortOrder,
        productCount: collection?.productsCount?.count,
        automated: Boolean(collection?.sources?.length),
        expectedCondition: conditionSummary(definition),
        sources: collection?.sources || [],
      }),
    );
  }

  console.log(`Product updates performed: ${productUpdates.filter((update) => update.after).length}`);
  console.log('Shopify userErrors: none');
}

main().catch((error) => {
  const env = existsSync('.env') ? readDotEnv(resolve(process.cwd(), '.env')) : {};
  const redacted = redact(error.message, [env.SHOPIFY_CLIENT_SECRET, env.SHOPIFY_CLIENT_ID]);
  console.error(redacted);
  process.exitCode = 1;
});
