import cookieParser from "cookie-parser";
import express from "express";
import { env } from "./config/env.js";
import { authRouter } from "./auth/router.js";
import { crmRouter } from "./crm/router.js";
import { errorHandler, notFound } from "./shared/http.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_request, response) => {
  response.status(200).json({ status: "ok", service: "nanobridge-crm-api" });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1", crmRouter);

app.use(notFound);
app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(env.PORT, () => console.log(`Nanobridge CRM API listening on port ${env.PORT}`));
}
