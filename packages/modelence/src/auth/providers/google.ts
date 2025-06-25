import { randomBytes } from "crypto";
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { usersCollection } from "../db";
import { setSessionUser } from "../session";

interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photos: { value: string }[];
}

async function authenticateUser(res: Response, userId: ObjectId) {
  const authToken = randomBytes(32).toString("base64url");
  await setSessionUser(authToken, userId);

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
    { 'google.id': googleUser.id },
  );

  if (existingUser) {
    await authenticateUser(res, existingUser._id);
    
    return;
  }

  const existingUserByEmail = await usersCollection.findOne(
    { 'emails.address': googleUser.email, },
    { collation: { locale: 'en', strength: 2 } },
  );

  // TODO: check if the email is verified
  if (existingUserByEmail) {
    // If the user exists but has a different Google ID, we can link the Google account
    await usersCollection.updateOne(
      { _id: existingUserByEmail._id },
      { $set: { google: { id: googleUser.id } } }
    );
    await authenticateUser(res, existingUserByEmail._id);
    return;
  }

  // If the user does not exist, create a new user
  const newUser = await usersCollection.insertOne({
    handle: googleUser.displayName,
    emails: [{
      address: googleUser.email,
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
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return googleAuthRouter;
  }

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
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
