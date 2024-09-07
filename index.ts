import * as expressive from "https://raw.githubusercontent.com/NMathar/deno-express/master/mod.ts";

const port = 3000;
const app = new expressive.App();
app.get("/", (_req, res) => {
  res.send("Hello from Replit\r\n");
});
const server = await app.listen(port, "0.0.0.0");
console.log("app listening on port " + server.port);