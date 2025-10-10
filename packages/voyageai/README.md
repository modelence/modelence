# @modelence/voyageai

[Voyage AI](https://www.voyageai.com/) Adapter for Modelence

## Installation

```bash
npm i @modelence/voyageai
```

## Overview

This package provides `VoyageStore`, a specialized Store class that integrates Voyage AI's embedding and reranking models with MongoDB Atlas Vector Search. It automatically generates embeddings for documents and enables semantic search with optional reranking capabilities.

The configuration can be set via Modelence Cloud or the following environment variable:

- MODELENCE_VOYAGEAI_API_KEY

## Supported Models

### Embedding Models

- `voyage-3-large` - High-quality embeddings (256, 512, 1024, 2048 dimensions)
- `voyage-3.5` - Latest generation embeddings (256, 512, 1024, 2048 dimensions)
- `voyage-3.5-lite` - Lightweight version (256, 512, 1024, 2048 dimensions)
- `voyage-code-3` - Optimized for code (256, 512, 1024, 2048 dimensions)
- `voyage-finance-2` - Finance domain-specific (1024 dimensions)
- `voyage-law-2` - Legal domain-specific (1024 dimensions)
- `voyage-code-2` - Legacy code embeddings (1536 dimensions)

### Reranking Models

- `rerank-2.5` - Latest reranking model
- `rerank-2.5-lite` - Lightweight reranking
- `rerank-2` - Previous generation
- `rerank-2-lite` - Lightweight previous generation
- `rerank-lite-1` - Legacy lightweight reranking

## Simple Usage

```ts
import { VoyageStore } from '@modelence/voyageai';
import { schema } from 'modelence/server';

const articles = new VoyageStore('articles', 'voyage-3.5', {
  schema: {
    title: schema.string(),
    author: schema.string(),
  },
  indexes: [],
});

// Insert with automatic embedding generation
await articles.insertOne({
  content: 'Artificial intelligence is transforming healthcare...',
  title: 'AI in Healthcare',
  author: 'John Doe',
});

// Perform vector search
const results = await articles.vectorSearch('machine learning in medicine', {
  limit: 5,
});
```

## Advanced Example

```ts
import { VoyageStore } from '@modelence/voyageai';
import { schema } from 'modelence/server';

const documents = new VoyageStore('documents', 'voyage-code-3', {
  dimension: 1024, // Custom dimension (optional)
  schema: {
    title: schema.string(),
    category: schema.string(),
    createdAt: schema.date(),
  },
  indexes: [
    { key: { category: 1 } },
    { key: { createdAt: -1 } },
  ],
  searchIndexes: [],
});

// Batch insert with automatic embeddings
await documents.insertMany([
  {
    content: 'React hooks allow you to use state in functional components...',
    title: 'Introduction to React Hooks',
    category: 'web-development',
    createdAt: new Date(),
  },
  {
    content: 'TypeScript provides static typing for JavaScript...',
    title: 'TypeScript Basics',
    category: 'programming',
    createdAt: new Date(),
  },
]);

// Vector search with reranking for improved relevance
const results = await documents.vectorSearch('how to use state in React', {
  limit: 10,
  numCandidates: 100,
  projection: {
    title: 1,
    category: 1,
    content: 1,
  },
  rerankModel: 'rerank-2.5',
});

// Results include score and all projected fields
results.forEach(doc => {
  console.log(`${doc.title}: ${doc.score}`);
});
```

## API Reference

### VoyageStore Constructor

```ts
new VoyageStore(name: string, model: VoyageModel, options: {
  dimension?: number;
  schema: TSchema;
  methods?: TMethods;
  indexes: IndexDescription[];
  searchIndexes?: SearchIndexDescription[];
})
```

### Methods

- `insertOne(document)` - Insert a single document with automatic embedding generation
- `insertMany(documents)` - Batch insert documents with automatic embeddings
- `vectorSearch(query, options)` - Perform semantic search with optional reranking

All standard Modelence Store methods are also available.
