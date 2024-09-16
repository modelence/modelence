import { MongoClient, ServerApiVersion } from 'mongodb';

let client: MongoClient | null = null;

export async function connect() {
  if (client) return client;

  client = new MongoClient(process.env.MONGODB_URI ?? '', {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });

  try {
    // Connect the client to the server
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error(err);
    client = null;
    throw err;
  }
}

export function getClient() {
  return client;
}

// export async function closeConnection() {
//   if (client) {
//     await client.close();
//     client = null;
//   }
// }
