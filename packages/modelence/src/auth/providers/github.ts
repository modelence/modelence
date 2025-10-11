import { getConfig } from "@/server";
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { usersCollection } from "../db";
import { createSession } from "../session";
import { getAuthConfig } from "@/app/authConfig";
import { getCallContext } from "@/app/server";

interface GitHubUser {
  id: string;
  displayName: string;
  username: string;
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


async function handleGitHubAuthenticationCallback(req: Request, res: Response) {
  const githubUser = req.user as GitHubUser;

  const existingUser = await usersCollection.findOne(
    { 'authMethods.github.id': githubUser.id },
  );

  const {
    session,
    connectionInfo,
  } = await getCallContext(req);

  try {
    if (existingUser) {
      await authenticateUser(res, existingUser._id);

      getAuthConfig().onAfterLogin?.({
        user: existingUser,
        session,
        connectionInfo,
      });
      getAuthConfig().login?.onSuccess?.(existingUser);

      return;
    }
  } catch(error) {
    if (error instanceof Error) {
      getAuthConfig().login?.onError?.(error);

      getAuthConfig().onLoginError?.({
        error,
        session,
        connectionInfo,
      });
    }
    throw error;
  }

  try {
    const githubEmail = githubUser.emails[0] && githubUser.emails[0]?.value;

    if (!githubEmail) {
      res.status(400).json({
        error: "Email address is required for GitHub authentication.",
      });
    }

    const existingUserByEmail = await usersCollection.findOne(
      { 'emails.address': githubEmail, },
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
      handle: githubEmail,
      emails: [{
        address: githubEmail,
        verified: true, // GitHub email is considered verified
      }],
      createdAt: new Date(),
      authMethods: {
        github: {
          id: githubUser.id,
        },
      },
    });

    await authenticateUser(res, newUser.insertedId);

    const userDocument = await usersCollection.findOne(
      { _id: newUser.insertedId },
      { readPreference: "primary" }
    );

    if (userDocument) {
      getAuthConfig().onAfterSignup?.({
        user: userDocument,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onSuccess?.(userDocument);
    }
  } catch(error) {
    if (error instanceof Error) {
      getAuthConfig().onSignupError?.({
        error,
        session,
        connectionInfo,
      });

      getAuthConfig().signup?.onError?.(error);
    }
    throw error;
  }
}

function getRouter() {
  const githubAuthRouter = Router();
  const githubEnabled = Boolean(getConfig('_system.user.auth.github.enabled'));
  console.log(githubEnabled);

  const githubClientId = String(getConfig('_system.user.auth.github.clientId'));
  const githubClientSecret = String(getConfig('_system.user.auth.github.clientSecret'));
  const githubScopes = getConfig('_system.user.auth.github.scopes');
  if (!githubEnabled || !githubClientId || !githubClientSecret) {
    return githubAuthRouter;
  }

  const scopes = githubScopes
    ? String(githubScopes).split(',').map(s => s.trim())
    : ['user:email'];

  passport.use(new GitHubStrategy({
    clientID: githubClientId,
    clientSecret: githubClientSecret,
    callbackURL: '/api/_internal/auth/github/callback',
    scope: scopes,
  }, (accessToken: string, refreshToken: string, profile: any, done: any) => {
    return done(null, profile);
  }));

  githubAuthRouter.get("/api/_internal/auth/github", passport.authenticate("github", {
    session: false,
  }));

  githubAuthRouter.get(
    "/api/_internal/auth/github/callback",
    passport.authenticate("github", { session: false }),
    handleGitHubAuthenticationCallback,
  );

  return githubAuthRouter;
}

export default getRouter;
