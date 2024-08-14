import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import crypto from 'crypto';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB

if (!TELEGRAM_BOT_TOKEN || !GEMINI_API_KEY) {
  throw new Error('TELEGRAM_BOT_TOKEN or GEMINI_API_KEY is not set in environment variables');
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const logger = {
  info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
};

// Simple in-memory cache (consider using Redis or another persistent store for production)
const analysisCache = new Map();

function sanitizeMarkdown(text) {
  const escapeChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  let sanitized = text;
  escapeChars.forEach(char => {
    sanitized = sanitized.replace(new RegExp('\\' + char, 'g'), '\\' + char);
  });
  return sanitized.length > 4000 ? sanitized.substring(0, 3997) + '...' : sanitized;
}

async function checkImageType(imageBuffer) {
  const signature = imageBuffer.toString('hex', 0, 4);
  const signatures = {
    'ffd8ffe0': 'image/jpeg',
    'ffd8ffe1': 'image/jpeg',
    '89504e47': 'image/png',
    '47494638': 'image/gif',
  };
  return signatures[signature] || 'unknown';
}

async function analyzeImage(imageBuffer, chatId) {
  try {
    const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
    if (analysisCache.has(imageHash)) {
      logger.info('Using cached analysis');
      return analysisCache.get(imageHash);
    }

    const model = genAI.getGenerativeModel({
      generationConfig: {
        temperature: 0,
        // topP: 0.95,
        // topK: 64,
        // maxOutputTokens: 8192,
        // responseMimeType: "text/plain",
      },
      model: 'gemini-1.5-flash'
    });

    const prompt = "Analyze this image and provide a detailed description. Include:\n" +
                   "1. Main subjects or objects\n" +
                   "2. Colors and visual elements\n" +
                   "3. Mood or atmosphere\n" +
                   "4. Any text visible in the image\n" +
                   "5. Potential context or setting\n" +
                   "Be concise but thorough. Format your response in easy-to-read Markdown.";

    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/jpeg'
        }
      },
      { text: prompt },
    ]);

    if (!result.response) {
      throw new Error('No response from Gemini API');
    }

    const analysis = sanitizeMarkdown(result.response.text());
    analysisCache.set(imageHash, analysis);
    return analysis;
  } catch (error) {
    logger.error('Error analyzing image:', error);
    throw new Error(`Failed to analyze image: ${error.message}`);
  }
}

async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);

    const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);

    if (imageBuffer.length > MAX_FILE_SIZE) {
      throw new Error(`Image size (${imageBuffer.length} bytes) exceeds the maximum allowed size`);
    }

    const imageType = await checkImageType(imageBuffer);
    if (imageType === 'unknown') {
      throw new Error('Unsupported image format. Please send a JPEG, PNG, or GIF image.');
    }

    await bot.sendMessage(chatId, "I'm analyzing your image. This may take a moment...");
    const analysis = await analyzeImage(imageBuffer, chatId);
    await bot.sendMessage(chatId, analysis, { parse_mode: 'MarkdownV2' });
  } catch (error) {
    logger.error('Error in handlePhoto:', error);
    let userMessage = "I'm sorry, but I couldn't analyze this image. ";
    if (error.message.includes('maximum allowed size')) {
      userMessage += "The image is too large. Please try sending a smaller image (under 4MB).";
    } else if (error.message.includes('Unsupported image format')) {
      userMessage += error.message;
    } else {
      userMessage += "An unexpected error occurred. Please try again later or with a different image.";
    }
    await bot.sendMessage(chatId, userMessage);
  }
}

async function handleStart(msg) {
  const chatId = msg.chat.id;
  const message = "Hello! I'm an advanced image analysis bot. Send me an image, and I'll provide a detailed description of what I see. You can also use these commands:\n\n" +
                  "/help - Get usage instructions\n" +
                  "/about - Learn more about my capabilities";
  await bot.sendMessage(chatId, message);
}

async function handleHelp(msg) {
  const chatId = msg.chat.id;
  const message = "Here's how to use me:\n\n" +
                  "1. Send me any image (JPEG, PNG, or GIF)\n" +
                  "2. I'll analyze it and provide a detailed description\n" +
                  "3. The analysis may take a few moments\n\n" +
                  "Tips:\n" +
                  "- Images should be under 4MB\n" +
                  "- Clear, well-lit images work best\n" +
                  "- I can identify objects, scenes, colors, text, and more\n" +
                  "- For best results, send images with interesting content or scenes";
  await bot.sendMessage(chatId, message);
}

async function handleAbout(msg) {
  const chatId = msg.chat.id;
  const message = "I'm an AI-powered image analysis bot using advanced machine learning to describe image contents. " +
                  "My capabilities include:\n\n" +
                  "- Object and scene recognition\n" +
                  "- Color and visual element analysis\n" +
                  "- Text detection in images\n" +
                  "- Mood and atmosphere interpretation\n" +
                  "- Contextual understanding of image settings\n\n" +
                  "I'm powered by Google's Gemini AI and I'm constantly learning and improving!";
  await bot.sendMessage(chatId, message);
}

export default async function handler(req, res) {
  try {
    const { body } = req;
    if (body.message) {
      if (body.message.photo) {
        await handlePhoto(body.message);
      } else if (body.message.text) {
        const text = body.message.text.toLowerCase();
        if (text === '/start') {
          await handleStart(body.message);
        } else if (text === '/help') {
          await handleHelp(body.message);
        } else if (text === '/about') {
          await handleAbout(body.message);
        } else {
          await bot.sendMessage(body.message.chat.id, "Please send me an image to analyze, or use /help for more information.");
        }
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error in webhook handler:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

// For local testing only
if (process.env.NODE_ENV === 'development') {
  const express = await import('express');
  const app = express.default();
  app.use(express.json());
  const PORT = process.env.PORT || 3000;

  app.post('/webhook', handler);

  app.listen(PORT, () => {
    logger.info(`Local server running on port ${PORT}`);
    logger.info(`Webhook URL: http://localhost:${PORT}/webhook`);
  });
}

logger.info('Advanced bot handler initialized');