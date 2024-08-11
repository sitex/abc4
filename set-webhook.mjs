// set-webhook.js
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function setWebhook(url) {
  try {
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
      url: url
    });
    console.log('Webhook set response:', response.data);
  } catch (error) {
    console.error('Error setting webhook:', error.response ? error.response.data : error.message);
  }
}

async function deleteWebhook() {
  try {
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`);
    console.log('Webhook deleted response:', response.data);
  } catch (error) {
    console.error('Error deleting webhook:', error.response ? error.response.data : error.message);
  }
}

async function getWebhookInfo() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    console.log('Current webhook info:', response.data);
  } catch (error) {
    console.error('Error getting webhook info:', error.response ? error.response.data : error.message);
  }
}

const command = process.argv[2];
const customUrl = process.argv[3];

switch (command) {
  case 'set':
    setWebhook(customUrl || WEBHOOK_URL);
    break;
  case 'delete':
    deleteWebhook();
    break;
  case 'info':
    getWebhookInfo();
    break;
  default:
    console.log('Usage: node set-webhook.js [set|delete|info] [custom-url]');
}