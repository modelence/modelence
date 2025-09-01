import { MongoClient, ServerApiVersion } from 'mongodb';
import { getConfig } from '../config/server';
import { time } from '../time';
import { EventEmitter } from "events";

let client: MongoClient | null = null;
let reconnecting = false;
let healthCheckInterval: NodeJS.Timeout | null = null;
let connectingPromise: Promise<MongoClient> | null = null;
export const dbEvents = new EventEmitter();

export async function connect(): Promise<MongoClient> {
  if (client) return client;

  if (connectingPromise) return connectingPromise;

  const mongodbUri = getMongodbUri();
  if (!mongodbUri) {
    throw new Error('MongoDB URI is not set');
  }

  connectingPromise = (async () => {
    const newClient = new MongoClient(mongodbUri, {
      maxPoolSize: 20,
      retryWrites: true,
      serverApi: ServerApiVersion.v1,
      serverSelectionTimeoutMS: time.seconds(5),
    });

    try {
      // Connect the client to the server
      await newClient.connect();
      // Send a ping to confirm a successful connection
      await newClient.db("admin").command({ ping: 1 });
      console.log("Pinged your deployment. You successfully connected to MongoDB!");

      client = newClient;
      startHealthCheck();
      return client;
    } catch (err) {
      client = null;
      throw err;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

export function getMongodbUri() {
  const value = getConfig('_system.mongodbUri');
  return value ? String(value) : undefined;
}

export function getClient() {
  if (!client) {
    throw new Error("MongoClient not initialized. Call connect() first.");
  }
  return client;
}

export async function closeConnection() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  
  await closeExistingClientConnection();
  
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
      reconnecting = false;
      console.log("Reconnected to MongoDB");
      dbEvents.emit("reconnected");
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
      await reconnect();
    }
  }, time.seconds(15)); // check every 15s
}