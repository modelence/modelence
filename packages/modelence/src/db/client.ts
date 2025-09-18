import { MongoClient, ServerApiVersion } from 'mongodb';
import { getConfig } from '../config/server';

let client: MongoClient | null = null;

export async function connect() {
  if (client) return client;

  const mongodbUri = getMongodbUri();
  if (!mongodbUri) {
    throw new Error('MongoDB URI is not set');
  }

  client = new MongoClient(mongodbUri, {
    maxPoolSize: 20
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

export function getMongodbUri() {
  const mongodbMode = getConfig('_system.mongodbMode');
  const value = (
    mongodbMode === 'custom' ?
    getConfig('_system.customMongodbUri') :
    getConfig('_system.mongodbUri')
  );
  return value ? String(value) : undefined;
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
