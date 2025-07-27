# Ollama Chat Shell

This is a simple chat shell UI for convenient communication with Ollama models, made as a pet project with heavy AI assistance.  
**Requires a running Ollama instance on your machine!**

The project was originally created for the *gemma3:12b* model, but you can use any model supported by Ollama and your hardware.

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

*npm run build*

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
