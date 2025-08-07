# Ollama Chat Shell

This is a simple chat shell UI for convenient communication with Ollama models, made as a pet project with heavy AI assistance.  
**Requires a running Ollama instance on your machine!**

Binary standalone archives of this chat can be found here - [simpra.org/soulchat](https://www.simpra.org/soulchat/?lang=en)

The project was originally created for the *gemma3:12b* model, but you can use any model supported by Ollama and your hardware.

It stores chat history into the chat_history/ChatHistory.json.gz, and monitors the history file size according to the config option history_max_file_kb, creating additional archive files if necessary.

Since gemma3:12b only sees images during initialization, and cannot do so in the chat, I implemented it so that if an image is attached to a message, such a message reinitializes the model so that it can see it. But it does not see the history of messages before this request, it is important to remember this. For testing, I added the image_include_messages option - it forcibly includes the specified number of chat threads in the message, but all attempts except 0 more often caused hallucinations in the model. The next message after this one with an image will already include the entire history up to the history_max_chars limit normally.

Remember, on first run, if no model downloaded with ollama, this chat will wait until model downloads, so this time is depends of model and your internet speed.

If the model did not respond for a long time and the error "⚠️ TypeError: fetch failed" appeared in the chat - the model is too "heavy" for your hardware, look for a smaller version or another one.

## Quick Features

- Clean chat interface for text conversations with Ollama models  
- Configurable in *config.json* (see below)  
- Minimal dependencies

## How to use

### 1. Install Node.js

- Download and install Node.js (version 18+ recommended):  
  https://nodejs.org/en/download/

### 2. Install dependencies

*npm install*

### 3. Change your *config.json*

In this repo the config does NOT contain API keys, but if you fork or extend the project with your own keys or tokens, be careful not to commit them to public repos!

### 4. Run in development mode

*npm start*

### 5. Build an exe (Windows)

*npm run make*

After build is complete, look for the .exe installer and/or the standalone archive in the *dist/* or *build/* folder.

---

## Contribution & License

Feel free to fork and modify for your own needs.

**If you want to support my work, you can donate via:**
- [DonationAlerts](https://www.donationalerts.ru/r/arsmeen)
- [StreamLabs](https://streamlabs.com/arsmeen#/ru)
- [PayPal](https://www.paypal.me/arsmarch)
- WebMoney: Z469771462654

---

**Note:** Do NOT commit your *config.json*, local SQLite/DB files, or private data(api keys).
