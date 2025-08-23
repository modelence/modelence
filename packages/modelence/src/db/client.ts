import { MongoClient, ServerApiVersion } from 'mongodb';
import { getConfig } from '../config/server';
import { time } from '../time';

let client: MongoClient | null = null;
let reconnecting = false;
let healthCheckInterval: number | null = null;

export async function connect(): Promise<MongoClient> {
  if (client) return client;

  const mongodbUri = getMongodbUri();
  if (!mongodbUri) {
    throw new Error('MongoDB URI is not set');
  }

  client = new MongoClient(mongodbUri, {
    maxPoolSize: 20,
    retryWrites: true,
    serverApi: ServerApiVersion.v1,
    serverSelectionTimeoutMS: time.seconds(5),
  });

  try {
    // Connect the client to the server
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    startHealthCheck(); // begin self-healing loop
    return client;
  } catch (err) {
    console.error(err);
    client = null;
    throw err;
  }
}

export function getMongodbUri() {
  const value = getConfig('_system.mongodbUri');
  return value ? String(value) : undefined;
}

export function getClient() {
  return client;
}

export async function closeConnection() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  
  if (client) {
    await client.close();
    client = null;
  }
  
  reconnecting = false;
}

async function closeExistingClientConnection() {
  if (client) {
    try {
      await client.close();
    } catch (closeErr) {
      console.warn('Error closing existing client:', closeErr);
    }
    client = null;
  }
}


async function reconnect() {
  if (reconnecting) return;
  reconnecting = true;

  let retries = 0;
  const maxRetries = 10;
  
  while (retries < maxRetries) {
    try {
      retries++;
      console.log(`Reconnecting to MongoDB (#${retries}/${maxRetries})...`);
      
      // Close existing client if it exists
      await closeExistingClientConnection();
      
      await connect();
      console.log("Reconnected to MongoDB");
      reconnecting = false;
      return;
    } catch (err) {
      const delay = Math.min(time.seconds(30), time.seconds(1) * Math.pow(2, retries)); //Max delay of 30s
      console.error(
        `Reconnect attempt #${retries}/${maxRetries} failed: ${err}. Retrying in ${delay / 1000}s...`
      );
      
      if (retries < maxRetries) {
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  
  console.error(`Failed to reconnect to MongoDB after ${maxRetries} attempts`);
  reconnecting = false;
}

function startHealthCheck() {
  // Clear existing health check to prevent duplicates
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(async () => {
    if (!client) return;
    
    try {
      await client.db("admin").command({ ping: 1 });
    } catch (err) {
      console.error("MongoDB ping failed, attempting to reconnect...", err);
      reconnect();
    }
  }, time.seconds(15)); // check every 15s
}