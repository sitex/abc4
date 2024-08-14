import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
}

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Utility logger
const logger = {
  info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
};

async function analyzeImage(imageBuffer, chatId) {
  try {
    logger.info('Initializing Gemini model...');
    const model = genAI.getGenerativeModel({
      generationConfig: {
        temperature: 0,
        // Uncomment the following lines if you want to use these parameters
        // topP: 0.95,
        // topK: 64,
        // maxOutputTokens: 8192,
        // responseMimeType: "text/plain",
      },
      model: 'gemini-1.5-flash'
    });
    logger.info('Gemini model initialized successfully');

    logger.info('Analyzing image with Gemini...');
    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/jpeg'
        }
      },
      { text: "Analyze this image and describe what you see. Provide your analysis in Markdown format, using appropriate headers, lists, and emphasis where relevant." },
    ]);

    logger.info('Gemini API response received');

    if (!result.response) {
      logger.error('No response from Gemini API');
      throw new Error('No response received from Gemini API');
    }

    const generatedResponse = result.response;
    logger.info('Analysis complete');

    if (!generatedResponse.text) {
      logger.error('No text in Gemini API response');
      throw new Error('No text content in Gemini API response');
    }

    let markdown = generatedResponse.text();
    logger.info('Original response content:', markdown.substring(0, 100) + '...');

    // Sanitize the markdown
    markdown = sanitizeMarkdown(markdown);
    logger.info('Sanitized response content:', markdown.substring(0, 100) + '...');

    // Send the analysis back to the user
    logger.info('Sending response to user...');
    await bot.sendMessage(chatId, markdown, { parse_mode: 'Markdown' });
    logger.info('Response sent successfully');
  } catch (error) {
    logger.error('Error analyzing image with Gemini:', error);
    logger.error('Full error object:', JSON.stringify(error, null, 2));

    if (error.message.includes('SAFETY') || error.message.includes('blocked due to safety')) {
      throw new Error('The image content could not be analyzed due to safety concerns. Please try a different image.');
    } else if (error.message.includes('rate limit')) {
      throw new Error('Gemini API rate limit exceeded. Please try again later.');
    } else if (error.message.includes('network')) {
      throw new Error('Network error occurred while connecting to Gemini API. Please check your internet connection.');
    } else if (error.message.includes("can't parse entities")) {
      throw new Error('There was an issue formatting the analysis. Ill try to send it without special formatting.');
    } else {
      throw new Error(`Failed to analyze image with Gemini API: ${error.message}`);
    }
  }
}

async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  logger.info('Received photo message. Chat ID:', chatId);
  try {
    // Get the file ID of the largest photo size
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    logger.info('Using file ID:', fileId);

    // Get file link
    let fileLink;
    try {
      fileLink = await bot.getFileLink(fileId);
      logger.info('File Link obtained:', fileLink);
    } catch (error) {
      logger.error('Error getting file link:', error);
      throw new Error('Failed to get file link from Telegram: ' + error.message);
    }

    // Download the image
    let imageBuffer;
    try {
      logger.info('Downloading image...');
      const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(imageResponse.data);
      logger.info('Image downloaded successfully. Size:', imageBuffer.length, 'bytes');

      if (imageBuffer.length > MAX_FILE_SIZE) {
        throw new Error(`Image size (${imageBuffer.length} bytes) exceeds the maximum allowed size of ${MAX_FILE_SIZE} bytes`);
      }
    } catch (error) {
      logger.error('Error downloading image:', error);
      throw new Error('Failed to download image from Telegram: ' + error.message);
    }

    // Analyze the image
    logger.info('Calling analyzeImage function...');
    await analyzeImage(imageBuffer, chatId);
    logger.info('analyzeImage function completed successfully');
  } catch (error) {
    logger.error('Error in handlePhoto:', error);
    logger.error('Stack trace:', error.stack);

    let userMessage;
    if (error.message.includes('safety concerns')) {
      userMessage = "I'm sorry, but I couldn't analyze this image due to potential safety concerns. Could you please try sending a different image?";
    } else if (error.message.includes('rate limit')) {
      userMessage = "I'm currently experiencing high demand. Please try again in a few minutes.";
    } else if (error.message.includes('network')) {
      userMessage = "I'm having trouble connecting to my image analysis service. Please try again later.";
    } else if (error.message.includes('Failed to get file link')) {
      userMessage = "I had trouble accessing the image you sent. Could you try uploading it again?";
    } else if (error.message.includes('Failed to download image')) {
      userMessage = "I couldn't download the image you sent. There might be an issue with the file. Could you try sending a different image?";
    } else if (error.message.includes('exceeds the maximum allowed size')) {
      userMessage = "The image you sent is too large for me to process. Please try sending a smaller image (under 4MB).";
    } else if (error.message.includes("can't parse entities")) {
      // If Markdown parsing failed, try to send the message without Markdown
      try {
        const plainText = error.message.replace(/(\*|_|`)/g, ''); // Remove Markdown symbols
        await bot.sendMessage(chatId, "I analyzed your image, but had trouble formatting the response. Here's the analysis without special formatting:");
        await bot.sendMessage(chatId, plainText);
        return;
      } catch (sendError) {
        userMessage = "I analyzed your image but had trouble sending the full response. Here's a summary: The image was successfully processed, but I couldn't display the full analysis due to a technical issue.";
      }
    } else {
      userMessage = `I encountered an unexpected error while processing your image. Here's what happened: ${error.message}`;
    }

    // Send the error message to the user
    try {
      await bot.sendMessage(chatId, userMessage);
    } catch (sendError) {
      logger.error('Error sending error message to user:', sendError);
    }
  }
}

async function handleDocument(msg) {
  const chatId = msg.chat.id;
  logger.info('Received document message:', JSON.stringify(msg, null, 2));
  try {
    const fileId = msg.document.file_id;
    const mimeType = msg.document.mime_type;

    if (!mimeType.startsWith('image/')) {
      await bot.sendMessage(chatId, 'Please send an image file.');
      return;
    }

    let fileLink;
    try {
      fileLink = await bot.getFileLink(fileId);
      logger.info('File Link:', fileLink);
    } catch (error) {
      logger.error('Error getting file link:', error);
      throw new Error('Failed to get file link from Telegram');
    }

    let imageBuffer;
    try {
      logger.info('Downloading image...');
      const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(imageResponse.data);
      logger.info('Image downloaded, size:', imageBuffer.length, 'bytes');

      if (imageBuffer.length > MAX_FILE_SIZE) {
        throw new Error(`Image size (${imageBuffer.length} bytes) exceeds the maximum allowed size of ${MAX_FILE_SIZE} bytes`);
      }
    } catch (error) {
      logger.error('Error downloading image:', error);
      throw new Error('Failed to download image from Telegram');
    }

    await analyzeImage(imageBuffer, chatId);
  } catch (error) {
    logger.error('Error in handleDocument:', error);
    logger.error('Stack trace:', error.stack);
    await bot.sendMessage(chatId, `Sorry, there was an error processing your image: ${error.message}`);
  }
}

export default async function handler(req, res) {
  logger.info('Webhook handler called');

  const timeout = setTimeout(() => {
    logger.error('Handler timed out');
    res.status(504).send('Gateway Timeout');
  }, 25000); // 25 seconds timeout

  try {
    const { body } = req;
    logger.info('Received body:', JSON.stringify(body, null, 2));

    if (body.message && body.message.photo) {
      await handlePhoto(body.message);
      clearTimeout(timeout);
      res.status(200).send('OK');
    } else if (body.message && body.message.document) {
      await handleDocument(body.message);
      clearTimeout(timeout);
      res.status(200).send('OK');
    } else if (body.message && body.message.text) {
      const chatId = body.message.chat.id;
      logger.info('Received text message:', body.message.text);
      await bot.sendMessage(chatId, 'I received your message. Please send me an image to analyze.');
      clearTimeout(timeout);
      res.status(200).send('OK');
    } else {
      logger.warn('Received unknown message type');
      clearTimeout(timeout);
      res.status(400).send('Bad Request: Unknown message type');
    }
    logger.info('Update handled successfully');
  } catch (error) {
    logger.error('Error in webhook handler:', error);
    logger.error('Stack trace:', error.stack);
    clearTimeout(timeout);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      stack: error.stack
    });
  }
}

// For local testing (comment out or remove for production)
if (process.env.NODE_ENV !== 'production') {
  import('express').then((express) => {
    const app = express.default();
    app.use(express.json());
    const PORT = process.env.PORT || 3000;

    app.post('/api/bot', handler);

    app.listen(PORT, () => {
      logger.info(`Local server running on port ${PORT}`);
      logger.info(`Webhook URL: http://localhost:${PORT}/api/bot`);
    });
  });
}