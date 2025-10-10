import { Store, schema } from "modelence/server";
import { IndexDescription, OptionalUnlessRequiredId, SearchIndexDescription, WithId } from "mongodb";
import type { ModelSchema, InferDocumentType } from "modelence/types";
import { VoyageAIClient } from "voyageai";

export type VoyageModel = 'voyage-3-large' | 'voyage-3.5' | 'voyage-3.5-lite' | 'voyage-code-3' | 'voyage-finance-2' | 'voyage-law-2' | 'voyage-code-2' | string;

const voyageModelSettings: Record<VoyageModel, { defaultDimension: number; dimensions: number[] }> = {
  'voyage-3-large': {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
  },
  'voyage-3.5': {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
  },
  'voyage-3.5-lite': {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
  },
  'voyage-code-3': {
    defaultDimension: 1024,
    dimensions: [256, 512, 1024, 2048],
  },
  'voyage-finance-2': {
    defaultDimension: 1024,
    dimensions: [1024],
  },
  'voyage-law-2': {
    defaultDimension: 1024,
    dimensions: [1024],
  },
  'voyage-code-2': {
    defaultDimension: 1536,
    dimensions: [1536],
  },
};

export class VoyageStore<TSchema extends ModelSchema, TMethods extends Record<string, (this: WithId<InferDocumentType<TSchema>> & TMethods, ...args: Parameters<any>) => any>> extends Store<TSchema, TMethods> {
  private indexName: string;
  private voyageai: VoyageAIClient;
  /**
   * Creates a new Store instance
   *
   * @param name - The collection name in MongoDB
   * @param options - Store configuration
   */
  constructor(name: string, model: VoyageModel, options: {
    /** Dimension of the vector embeddings (default: 1024) */
    dimension?: number;
    /** Document schema using Modelence schema types */
    schema: TSchema;
    /** Custom methods to add to documents */
    methods?: TMethods;
    /** MongoDB indexes to create */
    indexes: IndexDescription[];
    /** MongoDB Atlas Search */
    searchIndexes?: SearchIndexDescription[];
  }) {
    const dimension = voyageModelSettings[model]?.defaultDimension || 1024;
    const indexName = name + '_vector_index';
    const voyageai = new VoyageAIClient({
      apiKey: process.env.VOYAGEAI_API_KEY,
    });
    super(name, {
      ...options,
      searchIndexes: [...options.searchIndexes || [], {
        type: 'vectorSearch',
        name: indexName,
        definition: {
          field: 'embedding',
          dimensions: dimension,
          similarity: 'cosine',
        },
      }],
      schema: {
        content: schema.string(),
        embedding: schema.array(schema.number()).optional(),
        ...options.schema,
      },
    });
    this.indexName = indexName;
    this.voyageai = voyageai;
  }

  insertOne(document: OptionalUnlessRequiredId<this['_type']>) {
    const embedding = this.voyageai.embed(document.content);
    return super.insertOne({ ...document, embedding });
  }

  vectorSearch() {
    this.aggregate([
      {
        $vectorSearch: {
          index: this.indexName,
          path: "embedding",
          queryVector: voyage.embed("holiday cookie recipes without nuts"),
          numCandidates: 100,
          limit: 5
        }
      },
      {
        $project: {
          title: 1,
          score: { $meta: "vectorSearchScore" }
        }
      }
    ]);
  }
}
