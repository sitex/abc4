import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
}

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

export const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
export const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40MB, adjust as needed

export async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  console.log('Received photo message:', JSON.stringify(msg, null, 2));
  try {
    // Get file ID
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    console.log('File ID:', fileId);

    // Get file link
    let fileLink;
    try {
      fileLink = await bot.getFileLink(fileId);
      console.log('File Link:', fileLink);
    } catch (error) {
      console.error('Error getting file link:', error);
      throw new Error('Failed to get file link from Telegram');
    }

    // Download the image
    let imageBuffer;
    try {
      console.log('Downloading image...');
      const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(imageResponse.data);
      console.log('Image downloaded, size:', imageBuffer.length, 'bytes');

      if (imageBuffer.length > MAX_FILE_SIZE) {
        throw new Error(`Image size (${imageBuffer.length} bytes) exceeds the maximum allowed size of ${MAX_FILE_SIZE} bytes`);
      }
    } catch (error) {
      console.error('Error downloading image:', error);
      throw new Error('Failed to download image from Telegram');
    }

    // Use Gemini to analyze the image
    let generatedResponse;
    try {
      console.log('Analyzing image with Gemini...');

      const generationConfig = {
        temperature: 0,
      };

      const model = genAI.getGenerativeModel({
        generationConfig: generationConfig,
        model: "gemini-1.5-flash",
      });

      const result = await model.generateContent([
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/jpeg'
          }
        },
        {
          text: "Analyze this image and describe what you see. Provide your analysis in Markdown format, using appropriate headers, lists, tables and emphasis where relevant."
        },
      ]);

      generatedResponse = await result.response;
      console.log('Analysis complete');
    } catch (error) {
      console.error('Error analyzing image with Gemini:', error);
      throw new Error('Failed to analyze image with Gemini API');
    }

    // Send the analysis back to the user
    try {
      console.log('Sending response to user...');
      const markdown = generatedResponse.text();
      await bot.sendMessage(chatId, markdown, { parse_mode: 'Markdown' });
      console.log('Response sent');
    } catch (error) {
      console.error('Error sending response to user:', error);
      throw new Error('Failed to send analysis to user');
    }
  } catch (error) {
    console.error('Error in handlePhoto:', error);
    console.error('Stack trace:', error.stack);
    await bot.sendMessage(chatId, `Sorry, there was an error processing your image: ${error.message}`);
  }
}

export default async function handler(req, res) {
  console.log('Webhook handler called');

  const timeout = setTimeout(() => {
    console.error('Handler timed out');
    res.status(504).send('Gateway Timeout');
  }, 25000); // 25 seconds timeout

  try {
    const { body } = req;
    console.log('Received body:', JSON.stringify(body, null, 2));

    if (body.message && body.message.photo) {
      await handlePhoto(body.message);
      clearTimeout(timeout);
      res.status(200).send('OK');
    } else if (body.message && body.message.text) {
      const chatId = body.message.chat.id;
      console.log('Received text message:', body.message.text);
      await bot.sendMessage(chatId, 'I received your message. Please send me an image to analyze.');
      clearTimeout(timeout);
      res.status(200).send('OK');
    } else {
      console.log('Received unknown message type');
      clearTimeout(timeout);
      res.status(400).send('Bad Request: Unknown message type');
    }
    console.log('Update handled successfully');
  } catch (error) {
    console.error('Error in webhook handler:', error);
    console.error('Stack trace:', error.stack);
    clearTimeout(timeout);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      stack: error.stack
    });
  }
}

console.log('Bot handler initialized');