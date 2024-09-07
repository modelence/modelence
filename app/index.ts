import { loadModels } from '../data/dataSources';

import { MongoClient, ServerApiVersion } from 'mongodb';


export async function startApp() {
  await loadModels();

  const client = new MongoClient(process.env.MONGODB_URI ?? '', {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });

  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (err) {
    console.error(err);
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}
