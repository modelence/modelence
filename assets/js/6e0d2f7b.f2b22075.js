"use strict";(self.webpackChunkmodelence_docs=self.webpackChunkmodelence_docs||[]).push([[791],{3339:(e,n,s)=>{s.r(n),s.d(n,{assets:()=>h,contentTitle:()=>o,default:()=>j,frontMatter:()=>t,metadata:()=>r,toc:()=>a});const r=JSON.parse('{"id":"api-reference/store","title":"Store","description":"Stores allow you to:","source":"@site/docs/api-reference/store.md","sourceDirName":"api-reference","slug":"/api-reference/store","permalink":"/docs/api-reference/store","draft":false,"unlisted":false,"editUrl":"https://github.com/modelence/modelence/tree/main/docs/docs/api-reference/store.md","tags":[],"version":"current","sidebarPosition":4,"frontMatter":{"sidebar_position":4},"sidebar":"apiSidebar","previous":{"title":"Overview","permalink":"/docs/api-reference/intro"},"next":{"title":"Module","permalink":"/docs/api-reference/module"}}');var d=s(4848),i=s(8453);function l(e){const n={a:"a",code:"code",em:"em",h1:"h1",h2:"h2",h3:"h3",h4:"h4",h5:"h5",h6:"h6",hr:"hr",p:"p",pre:"pre",strong:"strong",...(0,i.R)(),...e.components};return(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)(n.p,{children:(0,d.jsx)(n.a,{href:"../../README.md",children:(0,d.jsx)(n.strong,{children:"modelence"})})}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.a,{href:"/docs/api-reference/README.md",children:"modelence"})," / ",(0,d.jsx)(n.a,{href:"/docs/api-reference/server/README.md",children:"server"})," / Store"]}),"\n",(0,d.jsx)(n.h1,{id:"class-storetschema-tmethods",children:"Class: Store<TSchema, TMethods>"}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L50",children:"src/data/store.ts:50"})]}),"\n",(0,d.jsx)(n.p,{children:"The Store class provides a type-safe interface for MongoDB collections with built-in schema validation and helper methods."}),"\n",(0,d.jsx)(n.h2,{id:"example",children:"Example"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"const dbTodos = new Store('todos', {\n  schema: {\n    title: schema.string(),\n    completed: schema.boolean(),\n    dueDate: schema.date().optional(),\n    userId: schema.userId(),\n  },\n  methods: {\n    isOverdue() {\n      return this.dueDate < new Date();\n    }\n  }\n});\n"})}),"\n",(0,d.jsx)(n.h2,{id:"type-parameters",children:"Type Parameters"}),"\n",(0,d.jsx)(n.h3,{id:"tschema",children:"TSchema"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"TSchema"})," ",(0,d.jsx)(n.em,{children:"extends"})," ",(0,d.jsx)(n.code,{children:"ModelSchema"})]}),"\n",(0,d.jsx)(n.p,{children:"The document schema type"}),"\n",(0,d.jsx)(n.h3,{id:"tmethods",children:"TMethods"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"TMethods"})," ",(0,d.jsx)(n.em,{children:"extends"})," ",(0,d.jsx)(n.code,{children:"Record"}),"<",(0,d.jsx)(n.code,{children:"string"}),", (",(0,d.jsx)(n.code,{children:"this"}),", ...",(0,d.jsx)(n.code,{children:"args"}),") => ",(0,d.jsx)(n.code,{children:"any"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"Custom methods that will be added to documents"}),"\n",(0,d.jsx)(n.h2,{id:"constructors",children:"Constructors"}),"\n",(0,d.jsx)(n.h3,{id:"constructor",children:"Constructor"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"new Store<TSchema, TMethods>(name, options): Store<TSchema, TMethods>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L76",children:"src/data/store.ts:76"})]}),"\n",(0,d.jsx)(n.p,{children:"Creates a new Store instance"}),"\n",(0,d.jsx)(n.h4,{id:"parameters",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"name",children:"name"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"string"})}),"\n",(0,d.jsx)(n.p,{children:"The collection name in MongoDB"}),"\n",(0,d.jsx)(n.h5,{id:"options",children:"options"}),"\n",(0,d.jsx)(n.p,{children:"Store configuration"}),"\n",(0,d.jsx)(n.h6,{id:"indexes",children:"indexes"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"IndexDescription"}),"[]"]}),"\n",(0,d.jsx)(n.p,{children:"MongoDB indexes to create"}),"\n",(0,d.jsx)(n.h6,{id:"methods",children:"methods?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"TMethods"})}),"\n",(0,d.jsx)(n.p,{children:"Custom methods to add to documents"}),"\n",(0,d.jsx)(n.h6,{id:"schema",children:"schema"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"TSchema"})}),"\n",(0,d.jsx)(n.p,{children:"Document schema using Modelence schema types"}),"\n",(0,d.jsx)(n.h4,{id:"returns",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Store"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),", ",(0,d.jsx)(n.code,{children:"TMethods"}),">"]}),"\n",(0,d.jsx)(n.h2,{id:"methods-1",children:"Methods"}),"\n",(0,d.jsx)(n.h3,{id:"aggregate",children:"aggregate()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"aggregate(pipeline, options?): AggregationCursor<Document>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L324",children:"src/data/store.ts:324"})]}),"\n",(0,d.jsx)(n.p,{children:"Aggregates documents using MongoDB's aggregation framework"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-1",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"pipeline",children:"pipeline"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Document"}),"[]"]}),"\n",(0,d.jsx)(n.p,{children:"The aggregation pipeline"}),"\n",(0,d.jsx)(n.h5,{id:"options-1",children:"options?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"AggregateOptions"})}),"\n",(0,d.jsx)(n.p,{children:"Optional options"}),"\n",(0,d.jsx)(n.h4,{id:"returns-1",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"AggregationCursor"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"The aggregation cursor"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"bulkwrite",children:"bulkWrite()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"bulkWrite(operations): Promise<BulkWriteResult>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L334",children:"src/data/store.ts:334"})]}),"\n",(0,d.jsx)(n.p,{children:"Performs a bulk write operation on the collection"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-2",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"operations",children:"operations"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"AnyBulkWriteOperation"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>[]"]}),"\n",(0,d.jsx)(n.p,{children:"The operations to perform"}),"\n",(0,d.jsx)(n.h4,{id:"returns-2",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"BulkWriteResult"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the bulk write operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"deletemany",children:"deleteMany()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"deleteMany(selector): Promise<DeleteResult>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L313",children:"src/data/store.ts:313"})]}),"\n",(0,d.jsx)(n.p,{children:"Deletes multiple documents"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-3",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"selector",children:"selector"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The selector to find the documents to delete"}),"\n",(0,d.jsx)(n.h4,{id:"returns-3",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"DeleteResult"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the delete operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"deleteone",children:"deleteOne()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"deleteOne(selector): Promise<DeleteResult>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L303",children:"src/data/store.ts:303"})]}),"\n",(0,d.jsx)(n.p,{children:"Deletes a single document"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-4",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"selector-1",children:"selector"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The selector to find the document to delete"}),"\n",(0,d.jsx)(n.h4,{id:"returns-4",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"DeleteResult"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the delete operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"fetch",children:"fetch()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:'fetch(query, options?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods[]>\n'})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L221",children:"src/data/store.ts:221"})]}),"\n",(0,d.jsxs)(n.p,{children:["Fetches multiple documents, equivalent to Node.js MongoDB driver's ",(0,d.jsx)(n.code,{children:"find"})," and ",(0,d.jsx)(n.code,{children:"toArray"})," methods combined."]}),"\n",(0,d.jsx)(n.h4,{id:"parameters-5",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"query",children:"query"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The query to filter documents"}),"\n",(0,d.jsx)(n.h5,{id:"options-2",children:"options?"}),"\n",(0,d.jsx)(n.p,{children:"Optional options"}),"\n",(0,d.jsx)(n.h6,{id:"limit",children:"limit?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"number"})}),"\n",(0,d.jsx)(n.h6,{id:"skip",children:"skip?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"number"})}),"\n",(0,d.jsx)(n.h6,{id:"sort",children:"sort?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"Document"})}),"\n",(0,d.jsx)(n.h4,{id:"returns-5",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"EnhancedOmit"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">, ",(0,d.jsx)(n.code,{children:'"_id"'}),"> & ",(0,d.jsx)(n.code,{children:"object"})," & ",(0,d.jsx)(n.code,{children:"TMethods"}),"[]>"]}),"\n",(0,d.jsx)(n.p,{children:"The documents"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"findbyid",children:"findById()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:'findById(id): Promise<\n  | null\n| EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>\n'})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L194",children:"src/data/store.ts:194"})]}),"\n",(0,d.jsx)(n.p,{children:"Fetches a single document by its ID"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-6",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"id",children:"id"}),"\n",(0,d.jsx)(n.p,{children:"The ID of the document to find"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"string"})," | ",(0,d.jsx)(n.code,{children:"ObjectId"})]}),"\n",(0,d.jsx)(n.h4,{id:"returns-6",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<\n| ",(0,d.jsx)(n.code,{children:"null"}),"\n| ",(0,d.jsx)(n.code,{children:"EnhancedOmit"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">, ",(0,d.jsx)(n.code,{children:'"_id"'}),"> & ",(0,d.jsx)(n.code,{children:"object"})," & ",(0,d.jsx)(n.code,{children:"TMethods"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"The document, or null if not found"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"findone",children:"findOne()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:'findOne(query, options?): Promise<\n  | null\n| EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>\n'})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L153",children:"src/data/store.ts:153"})]}),"\n",(0,d.jsx)(n.h4,{id:"parameters-7",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"query-1",children:"query"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.h5,{id:"options-3",children:"options?"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"FindOptions"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">"]}),"\n",(0,d.jsx)(n.h4,{id:"returns-7",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<\n| ",(0,d.jsx)(n.code,{children:"null"}),"\n| ",(0,d.jsx)(n.code,{children:"EnhancedOmit"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">, ",(0,d.jsx)(n.code,{children:'"_id"'}),"> & ",(0,d.jsx)(n.code,{children:"object"})," & ",(0,d.jsx)(n.code,{children:"TMethods"}),">"]}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"getdatabase",children:"getDatabase()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"getDatabase(): Db\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L343",children:"src/data/store.ts:343"})]}),"\n",(0,d.jsx)(n.p,{children:"Returns the raw MongoDB database instance for advanced operations"}),"\n",(0,d.jsx)(n.h4,{id:"returns-8",children:"Returns"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"Db"})}),"\n",(0,d.jsx)(n.p,{children:"The MongoDB database instance"}),"\n",(0,d.jsx)(n.h4,{id:"throws",children:"Throws"}),"\n",(0,d.jsx)(n.p,{children:"Error if the store is not provisioned"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"getname",children:"getName()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"getName(): string\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L93",children:"src/data/store.ts:93"})]}),"\n",(0,d.jsx)(n.h4,{id:"returns-9",children:"Returns"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"string"})}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"insertmany",children:"insertMany()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"insertMany(documents): Promise<InsertManyResult<Document>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L242",children:"src/data/store.ts:242"})]}),"\n",(0,d.jsx)(n.p,{children:"Inserts multiple documents"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-8",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"documents",children:"documents"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"OptionalUnlessRequiredId"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>[]"]}),"\n",(0,d.jsx)(n.p,{children:"The documents to insert"}),"\n",(0,d.jsx)(n.h4,{id:"returns-10",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"InsertManyResult"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the insert operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"insertone",children:"insertOne()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"insertOne(document): Promise<InsertOneResult<Document>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L232",children:"src/data/store.ts:232"})]}),"\n",(0,d.jsx)(n.p,{children:"Inserts a single document"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-9",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"document",children:"document"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"OptionalUnlessRequiredId"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The document to insert"}),"\n",(0,d.jsx)(n.h4,{id:"returns-11",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"InsertOneResult"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the insert operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"rawcollection",children:"rawCollection()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"rawCollection(): Collection<InferDocumentType<TSchema>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L352",children:"src/data/store.ts:352"})]}),"\n",(0,d.jsx)(n.p,{children:"Returns the raw MongoDB collection instance for advanced operations"}),"\n",(0,d.jsx)(n.h4,{id:"returns-12",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Collection"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The MongoDB collection instance"}),"\n",(0,d.jsx)(n.h4,{id:"throws-1",children:"Throws"}),"\n",(0,d.jsx)(n.p,{children:"Error if the store is not provisioned"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"renamefrom",children:"renameFrom()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"renameFrom(oldName, options?): Promise<void>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L361",children:"src/data/store.ts:361"})]}),"\n",(0,d.jsx)(n.p,{children:"Renames an existing collection to this store's name, used for migrations"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-10",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"oldname",children:"oldName"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"string"})}),"\n",(0,d.jsx)(n.p,{children:"The previous name of the collection"}),"\n",(0,d.jsx)(n.h5,{id:"options-4",children:"options?"}),"\n",(0,d.jsx)(n.h6,{id:"session",children:"session?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"ClientSession"})}),"\n",(0,d.jsx)(n.h4,{id:"returns-13",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"void"}),">"]}),"\n",(0,d.jsx)(n.h4,{id:"throws-2",children:"Throws"}),"\n",(0,d.jsx)(n.p,{children:"Error if the old collection doesn't exist or if this store's collection already exists"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"requirebyid",children:"requireById()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:'requireById(id, errorHandler?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>\n'})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L206",children:"src/data/store.ts:206"})]}),"\n",(0,d.jsx)(n.p,{children:"Fetches a single document by its ID, or throws an error if not found"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-11",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"id-1",children:"id"}),"\n",(0,d.jsx)(n.p,{children:"The ID of the document to find"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"string"})," | ",(0,d.jsx)(n.code,{children:"ObjectId"})]}),"\n",(0,d.jsx)(n.h5,{id:"errorhandler",children:"errorHandler?"}),"\n",(0,d.jsxs)(n.p,{children:["() => ",(0,d.jsx)(n.code,{children:"Error"})]}),"\n",(0,d.jsx)(n.p,{children:"Optional error handler to return a custom error if the document is not found"}),"\n",(0,d.jsx)(n.h4,{id:"returns-14",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"EnhancedOmit"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">, ",(0,d.jsx)(n.code,{children:'"_id"'}),"> & ",(0,d.jsx)(n.code,{children:"object"})," & ",(0,d.jsx)(n.code,{children:"TMethods"}),">"]}),"\n",(0,d.jsx)(n.p,{children:"The document"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"requireone",children:"requireOne()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:'requireOne(\n   query, \n   options?, \nerrorHandler?): Promise<EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods>\n'})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L161",children:"src/data/store.ts:161"})]}),"\n",(0,d.jsx)(n.h4,{id:"parameters-12",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"query-2",children:"query"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.h5,{id:"options-5",children:"options?"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"FindOptions"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">"]}),"\n",(0,d.jsx)(n.h5,{id:"errorhandler-1",children:"errorHandler?"}),"\n",(0,d.jsxs)(n.p,{children:["() => ",(0,d.jsx)(n.code,{children:"Error"})]}),"\n",(0,d.jsx)(n.h4,{id:"returns-15",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"EnhancedOmit"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">, ",(0,d.jsx)(n.code,{children:'"_id"'}),"> & ",(0,d.jsx)(n.code,{children:"object"})," & ",(0,d.jsx)(n.code,{children:"TMethods"}),">"]}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"updatemany",children:"updateMany()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"updateMany(\n   selector, \n   update, \noptions?): Promise<UpdateResult<Document>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L278",children:"src/data/store.ts:278"})]}),"\n",(0,d.jsx)(n.p,{children:"Updates multiple documents"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-13",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"selector-2",children:"selector"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The selector to find the documents to update"}),"\n",(0,d.jsx)(n.h5,{id:"update",children:"update"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"UpdateFilter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The MongoDB modifier to apply to the documents"}),"\n",(0,d.jsx)(n.h5,{id:"options-6",children:"options?"}),"\n",(0,d.jsx)(n.h6,{id:"session-1",children:"session?"}),"\n",(0,d.jsx)(n.p,{children:(0,d.jsx)(n.code,{children:"ClientSession"})}),"\n",(0,d.jsx)(n.h4,{id:"returns-16",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"UpdateResult"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the update operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"updateone",children:"updateOne()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"updateOne(selector, update): Promise<UpdateResult<Document>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L253",children:"src/data/store.ts:253"})]}),"\n",(0,d.jsx)(n.p,{children:"Updates a single document"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-14",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"selector-3",children:"selector"}),"\n",(0,d.jsx)(n.p,{children:"The selector to find the document to update"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"string"})," | ",(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.h5,{id:"update-1",children:"update"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"UpdateFilter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The update to apply to the document"}),"\n",(0,d.jsx)(n.h4,{id:"returns-17",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"UpdateResult"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the update operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"upsertmany",children:"upsertMany()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"upsertMany(selector, update): Promise<UpdateResult<Document>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L293",children:"src/data/store.ts:293"})]}),"\n",(0,d.jsx)(n.p,{children:"Updates multiple documents, or inserts them if they don't exist"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-15",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"selector-4",children:"selector"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The selector to find the documents to update"}),"\n",(0,d.jsx)(n.h5,{id:"update-2",children:"update"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"UpdateFilter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The MongoDB modifier to apply to the documents"}),"\n",(0,d.jsx)(n.h4,{id:"returns-18",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"UpdateResult"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the update operation"}),"\n",(0,d.jsx)(n.hr,{}),"\n",(0,d.jsx)(n.h3,{id:"upsertone",children:"upsertOne()"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:"upsertOne(selector, update): Promise<UpdateResult<Document>>\n"})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L267",children:"src/data/store.ts:267"})]}),"\n",(0,d.jsx)(n.p,{children:"Updates a single document, or inserts it if it doesn't exist"}),"\n",(0,d.jsx)(n.h4,{id:"parameters-16",children:"Parameters"}),"\n",(0,d.jsx)(n.h5,{id:"selector-5",children:"selector"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Filter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The selector to find the document to update"}),"\n",(0,d.jsx)(n.h5,{id:"update-3",children:"update"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"UpdateFilter"}),"<",(0,d.jsx)(n.code,{children:"InferDocumentType"}),"<",(0,d.jsx)(n.code,{children:"TSchema"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The MongoDB modifier to apply to the document"}),"\n",(0,d.jsx)(n.h4,{id:"returns-19",children:"Returns"}),"\n",(0,d.jsxs)(n.p,{children:[(0,d.jsx)(n.code,{children:"Promise"}),"<",(0,d.jsx)(n.code,{children:"UpdateResult"}),"<",(0,d.jsx)(n.code,{children:"Document"}),">>"]}),"\n",(0,d.jsx)(n.p,{children:"The result of the update operation"}),"\n",(0,d.jsx)(n.h2,{id:"properties",children:"Properties"}),"\n",(0,d.jsx)(n.h3,{id:"doc",children:"Doc"}),"\n",(0,d.jsx)(n.pre,{children:(0,d.jsx)(n.code,{className:"language-ts",children:'readonly Doc: EnhancedOmit<InferDocumentType<TSchema>, "_id"> & object & TMethods;\n'})}),"\n",(0,d.jsxs)(n.p,{children:["Defined in: ",(0,d.jsx)(n.a,{href:"https://github.com/modelence/modelence/blob/main/packages/modelence/src/data/store.ts#L61",children:"src/data/store.ts:61"})]})]})}function c(e={}){const{wrapper:n}={...(0,i.R)(),...e.components};return n?(0,d.jsx)(n,{...e,children:(0,d.jsx)(l,{...e})}):l(e)}const t={sidebar_position:4},o="Store",h={},a=[{value:"API Reference",id:"api-reference",level:2},{value:"Example",id:"example",level:2},{value:"Type Parameters",id:"type-parameters",level:2},{value:"TSchema",id:"tschema",level:3},{value:"TMethods",id:"tmethods",level:3},{value:"Constructors",id:"constructors",level:2},{value:"Constructor",id:"constructor",level:3},{value:"Parameters",id:"parameters",level:4},{value:"name",id:"name",level:5},{value:"options",id:"options",level:5},{value:"indexes",id:"indexes",level:6},{value:"methods?",id:"methods",level:6},{value:"schema",id:"schema",level:6},{value:"Returns",id:"returns",level:4},{value:"Methods",id:"methods-1",level:2},{value:"aggregate()",id:"aggregate",level:3},{value:"Parameters",id:"parameters-1",level:4},{value:"pipeline",id:"pipeline",level:5},{value:"options?",id:"options-1",level:5},{value:"Returns",id:"returns-1",level:4},{value:"bulkWrite()",id:"bulkwrite",level:3},{value:"Parameters",id:"parameters-2",level:4},{value:"operations",id:"operations",level:5},{value:"Returns",id:"returns-2",level:4},{value:"deleteMany()",id:"deletemany",level:3},{value:"Parameters",id:"parameters-3",level:4},{value:"selector",id:"selector",level:5},{value:"Returns",id:"returns-3",level:4},{value:"deleteOne()",id:"deleteone",level:3},{value:"Parameters",id:"parameters-4",level:4},{value:"selector",id:"selector-1",level:5},{value:"Returns",id:"returns-4",level:4},{value:"fetch()",id:"fetch",level:3},{value:"Parameters",id:"parameters-5",level:4},{value:"query",id:"query",level:5},{value:"options?",id:"options-2",level:5},{value:"limit?",id:"limit",level:6},{value:"skip?",id:"skip",level:6},{value:"sort?",id:"sort",level:6},{value:"Returns",id:"returns-5",level:4},{value:"findById()",id:"findbyid",level:3},{value:"Parameters",id:"parameters-6",level:4},{value:"id",id:"id",level:5},{value:"Returns",id:"returns-6",level:4},{value:"findOne()",id:"findone",level:3},{value:"Parameters",id:"parameters-7",level:4},{value:"query",id:"query-1",level:5},{value:"options?",id:"options-3",level:5},{value:"Returns",id:"returns-7",level:4},{value:"getDatabase()",id:"getdatabase",level:3},{value:"Returns",id:"returns-8",level:4},{value:"Throws",id:"throws",level:4},{value:"getName()",id:"getname",level:3},{value:"Returns",id:"returns-9",level:4},{value:"insertMany()",id:"insertmany",level:3},{value:"Parameters",id:"parameters-8",level:4},{value:"documents",id:"documents",level:5},{value:"Returns",id:"returns-10",level:4},{value:"insertOne()",id:"insertone",level:3},{value:"Parameters",id:"parameters-9",level:4},{value:"document",id:"document",level:5},{value:"Returns",id:"returns-11",level:4},{value:"rawCollection()",id:"rawcollection",level:3},{value:"Returns",id:"returns-12",level:4},{value:"Throws",id:"throws-1",level:4},{value:"renameFrom()",id:"renamefrom",level:3},{value:"Parameters",id:"parameters-10",level:4},{value:"oldName",id:"oldname",level:5},{value:"options?",id:"options-4",level:5},{value:"session?",id:"session",level:6},{value:"Returns",id:"returns-13",level:4},{value:"Throws",id:"throws-2",level:4},{value:"requireById()",id:"requirebyid",level:3},{value:"Parameters",id:"parameters-11",level:4},{value:"id",id:"id-1",level:5},{value:"errorHandler?",id:"errorhandler",level:5},{value:"Returns",id:"returns-14",level:4},{value:"requireOne()",id:"requireone",level:3},{value:"Parameters",id:"parameters-12",level:4},{value:"query",id:"query-2",level:5},{value:"options?",id:"options-5",level:5},{value:"errorHandler?",id:"errorhandler-1",level:5},{value:"Returns",id:"returns-15",level:4},{value:"updateMany()",id:"updatemany",level:3},{value:"Parameters",id:"parameters-13",level:4},{value:"selector",id:"selector-2",level:5},{value:"update",id:"update",level:5},{value:"options?",id:"options-6",level:5},{value:"session?",id:"session-1",level:6},{value:"Returns",id:"returns-16",level:4},{value:"updateOne()",id:"updateone",level:3},{value:"Parameters",id:"parameters-14",level:4},{value:"selector",id:"selector-3",level:5},{value:"update",id:"update-1",level:5},{value:"Returns",id:"returns-17",level:4},{value:"upsertMany()",id:"upsertmany",level:3},{value:"Parameters",id:"parameters-15",level:4},{value:"selector",id:"selector-4",level:5},{value:"update",id:"update-2",level:5},{value:"Returns",id:"returns-18",level:4},{value:"upsertOne()",id:"upsertone",level:3},{value:"Parameters",id:"parameters-16",level:4},{value:"selector",id:"selector-5",level:5},{value:"update",id:"update-3",level:5},{value:"Returns",id:"returns-19",level:4},{value:"Properties",id:"properties",level:2},{value:"Doc",id:"doc",level:3}];function x(e){const n={h1:"h1",h2:"h2",header:"header",li:"li",p:"p",ul:"ul",...(0,i.R)(),...e.components};return(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)(n.header,{children:(0,d.jsx)(n.h1,{id:"store",children:"Store"})}),"\n",(0,d.jsx)(n.p,{children:"Stores allow you to:"}),"\n",(0,d.jsxs)(n.ul,{children:["\n",(0,d.jsx)(n.li,{children:"Define type-safe schemas for your data"}),"\n",(0,d.jsx)(n.li,{children:"Handle CRUD operations with MongoDB"}),"\n",(0,d.jsx)(n.li,{children:"Add custom methods to your documents"}),"\n",(0,d.jsx)(n.li,{children:"Configure MongoDB indexes"}),"\n"]}),"\n",(0,d.jsx)(n.h2,{id:"api-reference",children:"API Reference"}),"\n","\n",(0,d.jsx)(c,{})]})}function j(e={}){const{wrapper:n}={...(0,i.R)(),...e.components};return n?(0,d.jsx)(n,{...e,children:(0,d.jsx)(x,{...e})}):x(e)}},8453:(e,n,s)=>{s.d(n,{R:()=>l,x:()=>c});var r=s(6540);const d={},i=r.createContext(d);function l(e){const n=r.useContext(i);return r.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function c(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(d):e.components||d:l(e.components),r.createElement(i.Provider,{value:n},e.children)}}}]);