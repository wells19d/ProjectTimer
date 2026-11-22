# Project Timer

During the first semester of my freshman year, many of my assignments asked me to estimate how long a project would take and then report how much time I actually spent on it. The idea was to help us learn to estimate our work and manage our time before getting into production development, where figuring out how long something will take can be difficult. A project estimated at 20 hours can easily turn into 40.

I would often forget how much time I had spent on a project because I didn't have a good way to track it. So, in Week 14, I spent a little time looking into what it would take to build something that did what I needed.

This is my little, simple project timer.

<img src="assets/project-timer.png" width="96" alt="Project Timer clock with play and pause controls">

## What it does

Project Timer is a small, offline desktop app for tracking time spent on projects and labs. Create a project, press Play when you start working, and press Stop when you take a break or finish. It keeps each work session and adds them together so you can see how much time the whole project took. Times display as `HH:MM:SS`.

It is built with JavaScript and Electron and saves everything locally in readable JSON. No account or server is needed.

**This project is for macOS only. Mobile, Windows PC, and Linux support are not included and will not be added.**

## Open source

I'm keeping this project open source. Feel free to fork it and make adjustments to fit your needs. If you share your version, please include a credit and a link to the original Project Timer repository in your README.

## Screenshots

**No projects yet**

<img src="assets/screenshots/no-projects.png" width="490" alt="Project Timer with an empty project list and the New project button">

**Four projects, with two collapsed**

<img src="assets/screenshots/four-projects.png" width="490" alt="Four projects: Projects 1 and 4 expanded with session and total times, and Projects 2 and 3 collapsed">

## Using the timer

- **New project** creates a named project with no time recorded.
- **Play** starts a new time block. **Stop** ends it.
- **Session** shows the current or most recent time block.
- **Total** adds all time blocks for that project.
- **From / Till** show the first start date and most recent stop date.
- Click a **project name** to rename it.
- Use the **arrow** to collapse or expand a project. It remembers your choice.
- **Delete** asks before removing a project and all its times.

Projects can run independently. Closing the app stops all timers; minimizing it leaves them running. After a crash, unfinished timers stop at the last saved heartbeat, which updates every five seconds while a timer runs.

Move and resize the window as needed. Once you resize it manually, it keeps your chosen size for that launch and scrolls if needed.

To share a screenshot or report a problem, choose **Support → Save Screenshot…** (or press **⌘⇧S**). This saves the current visible app contents as a PNG wherever you choose.

Choose **Support → Report a Problem…** to open the [GitHub issues page](https://github.com/wells19d/ProjectTimer/issues). Include your app version, what happened, and a screenshot if it helps explain the problem.

## Setup

You need **macOS 13+**, **Node.js 22.12+**, and **Yarn Classic 1.x**. Clone or download this repository before following either option below.

The first install needs internet access to download dependencies. After that, the app works offline.

### Run from an IDE or terminal

Open the project folder in VS Code, open its integrated terminal, and run:

```sh
yarn install
yarn start
```

After installing dependencies, you can also select **Run and Debug → Project Timer** and press **F5** in VS Code. Other IDEs can run the same terminal commands from the project folder.

This launches the desktop window. Start it with `yarn start`, rather than opening the HTML file in a browser. You can also use a regular terminal without an IDE.

### Install in Applications

If you'd rather launch it like a regular Mac app, open a terminal in the project folder and run:

```sh
yarn install
yarn build:mac
```

Quit any running copy of the timer before building. This builds and installs **Project Timer.app** in `/Applications`. Open it from Applications, Spotlight, or the Dock. No IDE or terminal window is needed when launching the installed app.

Run `yarn build:mac` again after changing or updating the code to update the installed app. If Applications is not writable, the finished app is also in `dist/` for you to move with Finder.

First-time installs start empty. Your development/sample projects are not included. Updates preserve the installed app's existing projects and times. Quit the app before updating; the installer will refuse to replace a running copy.

## Your data

Each copy of the app has its own **`data/projects.json`**. In development it is in the project folder; in the installed app it is inside `Project Timer.app/Contents/Resources/app/data/`. Click **Data file ↗** in the app to find the exact file.

**Quit the app before editing the JSON**, and make a backup first. Each block has a `start` and `end` timestamp, for example:

```json
{
  "start": "2026-11-22T09:00:00-06:00",
  "end": "2026-11-22T10:30:00-06:00"
}
```

Keep blocks in time order, with no overlaps within a project. Totals are calculated from these blocks when the app opens.

Updates carry the installed app's data into the replacement app. The JSON's `version` describes the data format, independently of the app version. If a future release changes that format, its migration converts the existing data and keeps a backup. If conversion is missing or fails, the update stops and leaves the old app and its data in place. App 1.0.1 still uses data format version 1.

## Sharing the source

`data/`, `node_modules/`, and `dist/` are excluded from Git. Include the source, `assets/`, `package.json`, and `yarn.lock` when sharing the project.

Each person should install dependencies and build their own Mac app. The current build uses this Mac's architecture and is signed locally for personal use rather than sharing as a prebuilt installer.

## Development

```sh
yarn test       # Run automated tests
yarn run check  # Check JavaScript syntax
```

The app code is in `src/`, build scripts are in `scripts/`, and the icon is in `assets/`. The build automatically prepares the Mac icon. To build without installing, use `yarn build:mac --package-only`.

## Versions

- **1.0.0** — Initial release.
- **1.0.1** — Window Screenshots (for support / reporting)
