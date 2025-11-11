# Wellness Hub - Gemini Development Guide

This document provides a guide for developing and maintaining the Wellness Hub project, intended for use by the Gemini AI assistant.

## Project Overview

Wellness Hub is a comprehensive health and lifestyle management platform featuring:
-   **Health Trackers:** Tools for monitoring habits like water intake, smoking, and more.
-   **Brain-Training Games:** A collection of games including Schulte Table, Memory Flip, and Sudoku.
-   **Full-Stack Architecture:** A frontend built with vanilla HTML, CSS, and JavaScript, and a backend powered by Python with Flask.

### Key Technologies:

-   **Frontend:**
    -   HTML5, CSS3, ES6+ JavaScript
    -   Modular design using ES6 modules
    -   RESTful API and WebSocket for communication
-   **Backend:**
    -   Python 3.10+
    -   Flask 3.0.2
    -   SQLite for the database
    -   Flask-Sock for WebSocket support
-   **Tooling:**
    -   Node.js (>=18.0.0) for frontend development (building, linting)
    -   `pip` for Python package management

## Building and Running

### Backend

1.  **Install Dependencies:**
    ```bash
    pip install -r backend/requirements.txt
    ```

2.  **Run the Server:**
    ```bash
    python3.10 -m backend.app
    ```
    The backend server will start on the port configured in the application (likely 8000).

### Frontend

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run the Development Server:**
    ```bash
    npm run serve
    ```
    This command starts a development server that serves the frontend and likely has hot-reloading features.

3.  **Build for Production:**
    ```bash
    npm run build
    ```
    This command builds the frontend assets for production, placing them in the `public` directory.

## Development Conventions

-   **Code Style:**
    -   **JavaScript:** ESLint Standard Style
    -   **CSS:** BEM naming conventions
-   **Commit Messages:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
-   **API:** The backend provides a RESTful API for data operations and a WebSocket for real-time communication. API endpoints are prefixed with `/api/`.
-   **Modularity:** The frontend JavaScript is organized into modules, with a clear separation of concerns between pages, components, and core utilities.
