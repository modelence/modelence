import { getConfig } from "@/server";
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { usersCollection } from "../db";
import { createSession } from "../session";

interface GoogleUser {
  id: string;
  displayName: string;
  emails: { value: string; }[];
  photos: { value: string }[];
}

async function authenticateUser(res: Response, userId: ObjectId) {
  const { authToken } = await createSession(userId);

  res.cookie("authToken", authToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  res.status(301);
  res.redirect("/");
}


async function handleGoogleAuthenticationCallback(req: Request, res: Response) {
  const googleUser = req.user as GoogleUser;

  const existingUser = await usersCollection.findOne(
    { 'authMethods.google.id': googleUser.id },
  );

  if (existingUser) {
    await authenticateUser(res, existingUser._id);
    
    return;
  }

  const googleEmail = googleUser.emails[0] && googleUser.emails[0]?.value;

  if (!googleEmail) {
    res.status(400).json({
      error: "Email address is required for Google authentication.",
    });
  }

  const existingUserByEmail = await usersCollection.findOne(
    { 'emails.address': googleEmail, },
    { collation: { locale: 'en', strength: 2 } },
  );

  // TODO: check if the email is verified
  if (existingUserByEmail) {
    // TODO: handle case with an HTML page
    res.status(400).json({
      error: "User with this email already exists. Please log in instead.",
    });
    return;
  }

  // If the user does not exist, create a new user
  const newUser = await usersCollection.insertOne({
    handle: googleEmail,
    emails: [{
      address: googleEmail,
      verified: true, // Google email is considered verified
    }],
    createdAt: new Date(),
    authMethods: {
      google: {
        id: googleUser.id,
      },
    },
  });

  await authenticateUser(res, newUser.insertedId);
}

function getRouter() {
  const googleAuthRouter = Router();
  const googleEnabled = getConfig('_system.user.auth.google.enabled') === "true";
  const googleClientId = String(getConfig('_system.user.auth.google.clientId'));
  const googleClientSecret = String(getConfig('_system.user.auth.google.clientSecret'));
  if (!googleEnabled || !googleClientId || !googleClientSecret) {
    return googleAuthRouter;
  }

  passport.use(new GoogleStrategy({
    clientID: googleClientId,
    clientSecret: googleClientSecret,
    callbackURL: '/api/_internal/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
  }));

  googleAuthRouter.get("/api/_internal/auth/google", passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }));

  googleAuthRouter.get(
    "/api/_internal/auth/google/callback",
    passport.authenticate("google", { session: false }),
    handleGoogleAuthenticationCallback,
  );

  return googleAuthRouter;
}

export default getRouter;
