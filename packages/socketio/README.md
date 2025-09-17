# @modelence/socketio

[Socket.IO](https://socket.io/) WebSocket Provider for Modelence

## Installation

```bash
npm i @modelence/socketio
```

## Overview

This package provides Socket.IO WebSocket provider for Modelence that enables real-time communication between client and server. It includes authentication support and room-based messaging.

## Backend Setup

```ts
import { startApp, ServerRoom } from 'modelence/server';
import socketioProvider from '@modelence/socketio';

// Define server rooms
const chatRoom = new ServerRoom({
  roomCategory: 'chat',
  canAccessRoom: async ({ user, roles }) => {
    return user !== null; // Only authenticated users can access
  }
});

startApp({
  websocket: {
    provider: socketioProvider
  },
  rooms: [chatRoom]
});
```

## Frontend Setup

```ts
import { ClientRoom } from 'modelence';
import socketioClient from '@modelence/socketio/client';

// Define client rooms
const chatRoom = new ClientRoom({
  roomCategory: 'chat',
  onData: (data) => {
    console.log('Chat message received:', data);
  }
});

socketioClient.init({
  rooms: [chatRoom]
});
```

## Advanced Example

```ts
// Backend - Broadcasting messages
import { getWebSocketConfig } from 'modelence/server';

const websocketConfig = getWebSocketConfig();
websocketConfig.provider?.broadcast({
  roomCategory: 'notifications',
  roomId: 'user123',
  data: { message: 'New notification!' }
});

// Frontend - Joining/leaving rooms
import { getWebsocketClientProvider } from 'modelence';

const client = getWebsocketClientProvider();
client?.joinRoom({
  roomCategory: 'chat',
  roomId: 'room1'
});

client?.leaveRoom({
  roomCategory: 'chat',
  roomId: 'room1'
});
```