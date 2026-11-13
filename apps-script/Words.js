/*
 * The words the app uses for what you're scheduling.
 *
 * Change these to reuse the app for something other than game nights: a book club, a band rehearsal,
 * a five-a-side kickabout, a team lunch. This one file is read by the website, by the Apps Script backend
 * (for the emails) and by the tests, so you only change it here. See "Make it your own" in README.md.
 *
 * Write the lower-case values the way they read in the middle of a sentence. The app capitalises them
 * where needed ("game night" becomes "Game night" and "GAME NIGHT").
 */
var GN_WORDS = {
  appName: 'Game Night',               // page title, header, email sender name
  event: 'game night',                 // the thing you lock in: "Flag game night", "Game night on Thu 19 Nov!"
  eventShort: 'night',                 // one word for the retro styles' small buttons: "Flag night"
  verb: 'play',                        // "Mark the days you can play", "Dean wants to play Thu 19 Nov"
  when: 'tonight',                     // reminder email subject: "Game night tonight: Helldivers"
  reminderTitle: "You're playing tonight", // big heading in the reminder email
  member: 'player',                    // "1 player"
  members: 'players',                  // "3 players"
  groupLabel: 'Game tag',              // the label for a group's name when creating one
  groupExample: 'Valheim',             // placeholder in that box
  groupHint: 'Create a group for a game you play', // shown when you have no groups yet
  pokeExample: "Keen for a few rounds? I'm free from 7." // placeholder for the note in a poke
};

if (typeof module !== 'undefined' && module.exports) module.exports = GN_WORDS;
