import { MongoClient } from 'mongodb';
import systemModule from '../system';
import packageJson from '../../package.json';

let client: MongoClient | null = null;

export async function connect() {
  if (client) return client;

  const mongodbUri = getMongodbUri();
  if (!mongodbUri) {
    throw new Error('MongoDB URI is not set');
  }

  const maxPoolSize = systemModule.getConfig('mongodbPoolSize');

  client = new MongoClient(mongodbUri, {
    driverInfo: {
      name: 'Modelence',
      version: packageJson.version,
    },
    ignoreUndefined: true,
    maxPoolSize,
  });

  try {
    // Connect the client to the server
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
    return client;
  } catch (err) {
    console.error(err);
    client = null;
    throw err;
  }
}

export function getMongodbUri() {
  return systemModule.getConfig('mongodbUri') || undefined;
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
