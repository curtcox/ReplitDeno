# My Deno Express App

This is a simple Deno application using the Express-like framework `expressive` for handling HTTP requests.

## Getting Started

### Running on Replit

You can run this project on Replit directly by clicking the button below:

[![Run on Replit](https://replit.com/badge/github/replit/clui)](https://replit.com/github/curtcox/ReplitDeno)

### Local Setup

To run this project locally, follow these steps:

1. **Clone the repository:**

    ```sh
    git clone https://github.com/curtcox/ReplitDeno.git
    cd ReplitDeno
    ```

2. **Run the application:**

    ```sh
    deno run --allow-net index.ts
    ```

## Application Overview

- **Endpoint:** `/`
- **Response:** "Hello from Replit\r\n"

The app listens on port `3000` and sends a simple greeting message when accessed via the root endpoint.