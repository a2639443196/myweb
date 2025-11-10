# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Wellness Hub** is a comprehensive web-based health and lifestyle management platform with a modern Chinese interface. It's designed as a collection of interactive tools for tracking various health metrics and activities with real-time features and AI integration.

## Development Commands

### Backend Development
```bash
# Start the Python Flask backend server
python3.10 -m backend.app

# Install backend dependencies
python3.10 -m pip install -r backend/requirements.txt

# Production deployment (creates systemd service)
./run_backend.sh

# Check backend health
curl http://localhost:8000/api/healthz
```

### Frontend Development
The frontend is served by the Flask backend at `http://localhost:8000`. No separate build process is required - it's vanilla HTML/CSS/JavaScript with ES6 modules.

### Database Operations
- **Location**: `backend/wellness.db` (SQLite)
- **Initialization**: Automatic on first run
- **Schema**: See `init_db()` function in `backend/app.py:664`

## Architecture

### Technology Stack
- **Frontend**: Vanilla HTML5/CSS3/ES6 JavaScript (no framework)
- **Backend**: Python Flask 3.0.2 with WebSocket support
- **Database**: SQLite (server-side) + IndexedDB (client-side)
- **Real-time**: WebSocket connections for live user presence
- **AI Integration**: Multiple LLM providers (OpenAI, DeepSeek, Qianwen, Doubao, Gemini)

### Directory Structure
```
├── backend/                 # Python Flask backend
│   ├── app.py              # Main Flask application (1495 lines)
│   ├── requirements.txt    # Python dependencies
│   ├── config/             # Configuration files
│   │   └── ai_agents.yaml  # AI service configurations
│   └── wellness.db         # SQLite database
├── css/                    # Stylesheets (modular)
├── js/                     # JavaScript modules (ES6)
├── *.html                  # Individual tool pages
├── index.html              # Main navigation/dashboard
└── run_backend.sh          # Production deployment script
```

### Key Architecture Patterns

#### Data Flow Architecture
1. **Client-Side Storage**: IndexedDB for offline functionality
2. **Server-Side Storage**: SQLite for user accounts and game records
3. **Real-time Features**: WebSocket connections (`/ws/online`, `/ws/liars-bar`)
4. **API Integration**: RESTful endpoints for data synchronization

#### Authentication & Session Management
- **Cookie-based sessions** with 30-day expiration
- **Session validation** via `/api/session` and `/api/session/heartbeat`
- **Online user tracking** with 60-second threshold
- **WebSocket integration** for real-time presence

#### Modular Frontend Design
- Each tool is a separate HTML file with dedicated JS/CSS modules
- Shared utilities in `js/activity-api.js` and `js/nav.js`
- Responsive design with mobile-first approach
- Theme system using CSS custom properties

## Core Features

### Health Tracking Tools
- **Water Tracker**: Daily hydration monitoring (`drink-water.html`)
- **Bowel Movement Tracker**: Digestive health monitoring (`bowel-tracker.html`)
- **Smoking Tracker**: Habit tracking (`smoking-tracker.html`)
- **"Slacking" Tracker**: Productivity/relaxation tracking (`slack-tracker.html`)

### Cognitive Training Games
- **Schulte Table**: Visual search training with leaderboards
- **Memory Flip**: Card matching game with performance tracking
- **Reaction Time**: Reflex testing with millisecond precision
- **Sudoku**: Logic puzzles with difficulty levels

### AI Integration
- **AI Battle Room**: Multi-agent LLM comparison platform
- **Configurable Agents**: 5 different AI providers with customizable prompts
- **Real-time Interaction**: WebSocket-based agent communication

## API Endpoints

### Authentication
- `POST /api/register` - User registration
- `POST /api/login` - User login
- `POST /api/logout` - User logout
- `GET /api/session` - Session validation
- `POST /api/session/heartbeat` - Keep session alive

### Activity Tracking
- `POST /api/activity` - Log user activity
- `GET /api/users/{username}/activity` - Get user activities

### Game Records & Leaderboards
- `GET /api/{game}/records/me` - Personal records
- `GET /api/{game}/leaderboard` - Global leaderboards
- `POST /api/{game}/records` - Submit game score

### Real-time Features
- `GET /api/online-users` - List online users
- `WS /ws/online` - Online user presence
- `WS /ws/liars-bar` - AI battle room communication

## Database Schema

### Core Tables
- **accounts**: User authentication and profiles
- **sessions**: Login session management
- **activities**: User activity logs with JSON details

### Game Record Tables
- **schulte_records**: Schulte table performance
- **reaction_records**: Reaction time scores
- **memory_flip_records**: Memory game results
- **sudoku_records**: Sudoku puzzle completion times

## Development Guidelines

### Adding New Tools
1. Create HTML file with consistent navigation structure
2. Add corresponding CSS module in `css/` directory
3. Create JavaScript module in `js/` with activity tracking
4. Integrate with existing authentication system
5. Add activity logging via `activity-api.js`

### Frontend Module System
- Use ES6 module imports (`import { ... } from './module.js'`)
- Follow existing naming conventions and code structure
- Implement responsive design using CSS custom properties
- Add proper error handling and user feedback

### Backend Development
- Follow Flask route patterns with proper HTTP status codes
- Use SQLite with proper foreign key constraints
- Implement activity logging for all user interactions
- Add proper error handling and JSON responses

### Testing & Deployment
- Test both frontend and backend functionality
- Verify WebSocket connections for real-time features
- Test mobile responsiveness across different screen sizes
- Use `run_backend.sh` for production deployment

## AI Agent Configuration

AI agents are configured in `backend/config/ai_agents.yaml` with:
- Multiple LLM providers (OpenAI, DeepSeek, Qianwen, Doubao, Gemini)
- Customizable system prompts and user templates
- Environment variable configuration for API keys
- Default parameters for each model

## Security Considerations

- Session tokens are stored in HTTP-only cookies
- Password hashing using SHA-256
- CORS handling for cross-origin requests
- Input validation and sanitization
- WebSocket connection validation