import express from 'express';
import dotenv from 'dotenv';
import handler from './bot.mjs';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  console.log('Received webhook request');
  await handler(req, res);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log('To use ngrok, run: ngrok http 3000');
  console.log('Then set the webhook: npm run webhook:set <your-ngrok-url>/webhook');
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

console.log('Local bot server initialized');