---
sidebar_position: 2
---

# Setup

You can either continue using your Modelence project as it is, or connect it to Modelence Cloud.
We've built Modelence Cloud to seamless host and monitor Modelence applications, and it's designed for both scalable production apps
as well as local development environments. By connecting your local project, you can use a free remote MongoDB database without having to set up your own, and you will also get access to logs, metrics and performance insights of your locally running application.

If you want to skip this for now, feel free to ignore the "Connecting to Modelence Cloud" section below and continue with the rest of the steps.

## Connecting to Modelence Cloud

First, you need to create a free Modelence account by going to [Modelence Cloud](https://cloud.modelence.com).
After you've logged in, create a new application and name it after your project. This same application will be used for both local development and production deployment (as well as any other environments like staging) in the future.
After you've created an application, create a new environment. Name your environment so it can uniquely identify your local development environment, e.g. `dev-YourName` rather than just `dev` (unless you're sure there won't be anyone else working on the same project later).

After you've created a new environment, you will be redirected to the environment's dashboard and should see a setup card with a `Go to Setup` button, redirecting you to your environment's Setup page. In this page, you'll see a `Setup Local Environment` button, which will show commands for either creating a new project or connecting an existing one. Since you've already created a project, go with `Connect Existing Modelence Project` and copy the corresponding shell command displayed in the popup. It should look like this:

```bash
modelence setup --token <token>
```

Once you run this command in your project's root directory, it will automatically create a `.modelence.env` file with the necessary environment variables.

Stop and restart your `npm run dev` command after this step.
Now, if everything is set up correctly, you should see your environment status go from `inactive` to `active` in the Modelence Cloud dashboard.

## Setting up MongoDB

If you've connected your local project to Modelence Cloud, as described in the section above, no more setup is needed - you are automatically set up with a MongoDB database that is included with your remote environment and can skip this section.

If you skipped the Modelence Cloud setup, the easiest way to set up MongoDB is to use the [MongoDB Atlas](https://www.mongodb.com/atlas) free tier. While you can set up your own local MongoDB instance, we recommend Atlas because it eliminates the need for local installation and provides cloud storage for your development data, protecting it from local environment issues or data loss.

### Setting up MongoDB with Atlas

Follow the steps below to set up a MongoDB Atlas cluster. For more detailed instructions, you can refer to https://www.mongodb.com/docs/guides/atlas/cluster/

**Create an Atlas Account**
  - Go to [MongoDB Atlas](https://www.mongodb.com/atlas).
  - Sign up for a new account or log in if you already have one

**Create a Free Cluster**
  - Click "Build a Database"
  - Choose the "FREE" tier (labeled as "Shared" or "M0")
  - Select your preferred cloud provider and region
  - Click "Create" to deploy your cluster (this may take a few minutes)

Follow the steps below to set up a database user. For more detailed instructions, you can refer to https://www.mongodb.com/docs/guides/atlas/db-user/

**Set up Database Access**
  - In the Security Quickstart page, select "Username and Password" authentication
  - Enter a username in the first text field
  - For the password, either:
    - Enter your own secure password, or
    - Click "Autogenerate Secure Password" to let Atlas create one
  - Click "Create User"

Follow the steps below to configure network access. For more detailed instructions, you can refer to https://www.mongodb.com/docs/guides/atlas/network-connections/

**Configure Network Access**
  - In the Security Quickstart page, select "My Local Environment"
  - In the "Add entries to your IP Access List" section, you can either:
    - Click "Add My Current IP Address" to add your current IP
    - For development, click "Allow Access from Anywhere" (0.0.0.0/0)
  - Click "Finish and Close"

:::tip
Do not load sample data into your newly created database if prompted - Modelence already provisions what you need and will work perfectly with an empty database on the first run.
:::

Follow the steps below to get your connection string. For more detailed instructions, you can refer to https://www.mongodb.com/docs/guides/atlas/connection-string/

5. **Get Your Connection String**
   - Return to the "Database" page
   - Click "Connect" on your cluster
   - Select "Drivers" under "Connect Your Application"
   - Choose the latest Node.js version and copy the connection string
   - Replace the `<username>` and `<password>` in the string with your database user's username and password
   - Add your desired database name to the connection string (otherwise it will default to `test`), so it looks like this:

```
mongodb+srv://<username>:<password>@<cluster_name>.mongodb.net/<database-name>?retryWrites=true&w=majority
```

Once you have your connection string, you'll need to add it to your Modelence environment variables. Create a `.modelence.env` file in your project root (if it doesn't exist already) and add:

```env
MONGODB_URI="<your_connection_string_here>"
```

Make sure that your `.modelence.env` file is added to your `.gitignore` to keep your credentials secure.

## Getting Started
