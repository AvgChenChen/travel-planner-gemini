# Atlas: Travel Research Desk

This version uses a free-friendly backend:

- Gemini API for the final travel JSON
- Tavily API for live web search sources
- Express backend so keys stay out of the browser
- Same Vite + React + Tailwind frontend

## Get free keys

1. Gemini API key: https://aistudio.google.com/app/apikey
2. Tavily API key: https://app.tavily.com

## Setup

From the project folder:

```bash
cd ~/Desktop/travel-planner
npm install
```

Create or open `.env`:

```bash
touch .env
open -a TextEdit .env
```

Paste this into `.env`:

```env
GEMINI_API_KEY=paste_your_gemini_key_here
TAVILY_API_KEY=paste_your_tavily_key_here
GEMINI_MODEL=gemini-3.5-flash
PORT=3001
```

Save the file.

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

## Important

Keep Terminal open while using the app.

If Gemini says the model is unavailable, change this line in `.env`:

```env
GEMINI_MODEL=gemini-2.5-flash
```

Then stop the app with Control + C and run:

```bash
npm run dev
```

## Common errors

### Missing GEMINI_API_KEY
Your `.env` file is missing the Gemini key.

### Missing TAVILY_API_KEY
Your `.env` file is missing the Tavily key.

### Gemini request failed
The Gemini key is wrong, billing/free access is blocked, or the model name is unavailable.

### Tavily search failed
The Tavily key is wrong or out of credits.
