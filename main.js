//A botkit based guildwars helperbot
//Author: Roger Lampe roger.lampe@gmail.com
var debug = false; //for debug messages, passe to api and botkit
var dataLoaded = false; //To signal the bot that the async data load is finished.
var toggle = true; //global no-real-use toggle. Used at present to compare 'craft' command output formats.

var Botkit = require('botkit');
var os = require('os');
var fs = require('fs');
var gw2nodelib = require('./api.js');
gw2nodelib.loadCacheFromFile('cache.json'); //note that this file name is a suffix. Creates itemscache.json, recipecache,json, and so on

var prefixData = loadStaticDataFromFile('prefix.json');
var helpFile = [];
var sass = loadStaticDataFromFile('sass.json');
var lastSass = [];

controller = Botkit.slackbot({
  debug: debug,
  json_file_store: 'slackbotDB',
});

//Check for bot token
if (!process.env.token) {
  bot.botkit.log('Error: Specify token in environment');
  process.exit(1);
}
//fire up the bot
var bot = controller.spawn({
  token: process.env.token
}).startRTM(function(err, bot, payload) {
  if (err) {
    throw new Error('Could not connect to Slack');
  }
});

////HELP
controller.hears(['^help', '^help (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var matches = message.text.match(/help ([a-zA-Z ]*)/i);
  if (!matches || !matches[1] || !helpFile[matches[1].toLowerCase()]) bot.reply(message, "Help topics: " + listKeys(helpFile));
  else {
    var name = matches[1].toLowerCase();
    bot.reply(message, helpFile[name]);
  }
});

////SASS
controller.hears(['^sass'], 'direct_message,direct_mention,mention', function(bot, message) {
  var replySass = sass[Math.floor(Math.random() * sass.length)];
  while (lastSass.indexOf(replySass) > -1) {
    if (debug) bot.botkit.log('dropping recent sass: ' + replySass);
    replySass = sass[Math.floor(Math.random() * sass.length)];
  }
  lastSass.push(replySass);
  if (lastSass.length > 5) lastSass.shift();
  if (replySass[replySass.length - 1] !== '.') { //sass ending with a period is pre-sassy. Add sass if not.
    var suffix = [", you idiot.", ", dumbass. GAWD.", ", as everyone but you knows.", ", you bookah.", ", grawlface.", ", siamoth-teeth."];
    replySass += suffix[Math.floor(Math.random() * suffix.length)];
  }
  bot.reply(message, replySass);
});


////////////////recipe lookup. I apologize.
helpFile.craft = "Lessdremoth will try to get you a list of base ingredients. Takes one argument that can contain spaces. Note mystic forge recipes will just give the 4 forge ingredients. Example:craft Light of Dwyna.";
controller.hears(['^craft (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  //function to assemble an attahcment and call bot reply. Used when finally responding with a recipe
  var replyWithRecipeFor = function(itemToMake) {
    var attachments = assembleRecipeAttachment(itemToMake);
    var foundRecipe = findInData('output_item_id', itemToMake.id, 'recipes');
    var amountString;
    if (foundRecipe && foundRecipe.output_item_count && foundRecipe.output_item_count > 1) { //if it's a multiple, collect multiple amount
      amountString = foundRecipe.output_item_count;
    }
    bot.reply(message, {
      'text': itemToMake.name + (amountString ? " x " + amountString : "") + (itemToMake.level ? " (level " + itemToMake.level + ")" : "") + (itemToMake.description ? "\n" + itemToMake.description : ""),
      attachments: attachments,
      // 'icon_url': itemToMake.icon,
      // "username": "RecipeBot",
    }, function(err, resp) {
      if (err || debug) bot.botkit.log(err, resp);
    });

  };

  var matches = message.text.match(/craft (.*)/i);
  if (!dataLoaded) { //still loading
    bot.reply(message, "I'm still loading data. Please check back in a couple of minutes. If this keeps happening, try 'db reload'.");
  } else if (!matches || !matches[0]) { //weird input issue
    bot.reply(message, "I didn't quite get that. Maybe ask \'help craft\'?");
  } else { //search for recipes that produce items with names that contain the search string
    var searchTerm = matches[1];
    var itemSearchResults = findCraftableItemByName(searchTerm);
    if (debug) bot.botkit.log(itemSearchResults.length + " matches found");
    if (itemSearchResults.length === 0) { //no match
      bot.reply(message, "No item names contain that exact text.");
    } else if (itemSearchResults.length == 1) { //exactly one. Ship it.
      replyWithRecipeFor(itemSearchResults[0]);
    } else if (itemSearchResults.length > 10) { //too many matches in our 'contains' search, notify and give examples.
      var itemNameFirst = itemSearchResults[0].name;
      var itemNameLast = itemSearchResults[itemSearchResults.length - 1].name;
      bot.reply(message, "Woah. I found " + itemSearchResults.length + ' items. Get more specific.\n(from ' + itemNameFirst + ' to ' + itemNameLast + ')');
    } else { //10 items or less, allow user to choose
      bot.startConversation(message, function(err, convo) {
        var listofItems = '';
        for (var i in itemSearchResults) {
          var levelString; //Attempt to differentiate same-name items by their level, or their level in the description
          if (itemSearchResults[i].level) {
            levelString = itemSearchResults[i].level;
          } else if (itemSearchResults[i].description) {
            var matches = itemSearchResults[i].description.match(/level (\d{1,2})/i);
            if (debug) bot.botkit.log("matches " + JSON.stringify(matches) + " of description " + itemSearchResults[i].description);
            if (matches && matches[1]) {
              levelString = matches[1];
            }
          }
          listofItems += '\n' + [i] + ": " + itemSearchResults[i].name + (levelString ? " (level " + levelString + ")" : "") + (itemSearchResults[i].forged ? " (Mystic Forge)" : "");
        }
        convo.ask('I found multiple items with that name. Which number you mean? (say no to quit)' + listofItems, [{
          //number, no, or repeat
          pattern: new RegExp(/^(\d{1,2})/i),
          callback: function(response, convo) {
            var matches = response.text.match(/^(\d{1,2})/i);
            var selection = matches[0];
            if (selection < itemSearchResults.length) {
              replyWithRecipeFor(itemSearchResults[selection]);
            } else convo.repeat();
            convo.next();
          }
        }, {
          pattern: bot.utterances.no,
          callback: function(response, convo) {
            convo.say('\'Kay.');
            convo.next();
          }
        }, {
          default: true,
          callback: function(response, convo) {
            // just repeat the question
            convo.repeat();
            convo.next();
          }
        }]);
      });
    }
  }
});

//////DATA
controller.hears(['^db reload$'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, 'Are you sure? It can take a long time. Say \'db reload go\' to lauch for real');
});

controller.hears(['^db reload go$'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, 'You asked for it. Starting reload.');
  gw2nodelib.data.recipes = [];
  gw2nodelib.data.items = [];
  globalMessage = message;
  dataLoaded = false;
  var start = new Date().getTime();
  gw2nodelib.load("recipes", {}, true, halfCallback, doneCallback, errorCallback);
});


/////QUAGGANS
helpFile.quaggans = "fetch a list of all fetchable quaggan pictures. See help quaggan.";
helpFile.quaggan = "Takes an argument. Lessdremoth pastes a url to a picture of that quaggan for slack to fetch. Also see help quaggans. Example: 'quaggan box'";

controller.hears(['^quaggans$', '^quaggan$'], 'direct_message,direct_mention,mention', function(bot, message) {
  gw2nodelib.quaggans(function(jsonList) {
    if (jsonList.text || jsonList.error) {
      bot.reply(message, "Oops. I got this error when asking about quaggans: " + (jsonList.text ? jsonList.text : jsonList.error));
    } else {
      bot.reply(message, "I found " + Object.keys(jsonList).length + ' quaggans.');
      bot.reply(message, "Tell Lessdremoth quaggan <quaggan name> to preview!");
      bot.reply(message, listToString(jsonList));
    }
  });
});

controller.hears(['quaggan (.*)', 'quaggans (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var matches = message.text.match(/quaggans? (.*)/i);
  if (!matches || !matches[1]) bot.reply(message, "Which quaggan? Tell Lessdremoth \'quaggans\' for a list.");
  var name = removePunctuationAndToLower(matches[1]);
  gw2nodelib.quaggans(function(jsonItem) {
    if (jsonItem.text || jsonItem.error) {
      bot.reply(message, "Oops. I got this error when asking about your quaggan: " + (jsonItem.text ? jsonItem.text : jsonItem.error));
    } else {
      bot.reply(message, jsonItem.url);
    }
  }, {
    id: name
  });
});

/////ACCESS TOKEN
helpFile.access = "Set up your guild wars account to allow lessdremoth to read data. Direct Message 'access token help' for more information.";
controller.hears(['access token'], 'direct_mention,mention', function(bot, message) {
  bot.reply(message, "Direct message me the phrase \'access token help\' for help.");
});

controller.hears(['access token help'], 'direct_message', function(bot, message) {
  bot.reply(message, "First you'll need to log in to arena net to create a token. Do so here:");
  bot.reply(message, "https://account.arena.net/applications");
  bot.reply(message, "Copy the token, and then direct message me (here) with \'access token <your token>\'");
  controller.storage.users.get(message.user, function(err, user) {
    if (user) {
      bot.reply(message, "Although I already have an access token on file for you.");
    }
  });
});

controller.hears(['access token (.*)'], 'direct_message', function(bot, message) {
  var matches = message.text.match(/access token (.*)/i);
  if (!matches[1]) bot.reply(message, "I didn't get that.");
  var token = matches[1];
  controller.storage.users.get(message.user, function(err, user) {
    if (user) {
      bot.reply(message, "I overwrote your existing token.");
    } else {
      user = {
        id: message.user,
      };
    }
    user.access_token = token;
    controller.storage.users.save(user, function(err, id) {
      bot.reply(message, 'Got it.');
    });
  });
});

/////CHARACTERS
helpFile.characters = "Display a report of characters on your account, and their career deaths.";
controller.hears(['characters'], 'direct_message,direct_mention,mention', function(bot, message) {
  controller.storage.users.get(message.user, function(err, user) {
    if (!user || !user.access_token) {
      bot.reply(message, "Sorry, I don't have your access token on file. direct message me the phrase \'access token help\' for help.");
    } else gw2nodelib.characters(function(jsonList) {
      if (jsonList.text || jsonList.error) {
        bot.reply(message, "Oops. I got this error when asking for a list of your characters: " + (jsonList.text ? jsonList.text : jsonList.error));
      } else {
        bot.reply(message, "I found " + Object.keys(jsonList).length + ' characters.');
        gw2nodelib.characters(function(jsonList) {
          if (jsonList.text || jsonList.error) {
            bot.reply(message, "Oops. I got this error when asking about characters: " + (jsonList.text ? jsonList.text : jsonList.error));
          } else {
            var attachments = [];
            var attachment = {
              color: '#000000',
              thumb_url: "https://cdn4.iconfinder.com/data/icons/proglyphs-signs-and-symbols/512/Poison-512.png",
              fields: [],
            };
            var totalDeaths = 0;
            for (var n in jsonList) {
              if (debug) bot.botkit.log("char :" + jsonList[n]);
              attachment.fields.push({
                title: jsonList[n].name,
                value: jsonList[n].deaths,
                short: true,
              });
              totalDeaths += jsonList[n].deaths;
            }
            attachment.title = 'Death Report: ' + totalDeaths + ' total deaths.';
            attachments.push(attachment);
            bot.reply(message, {
              attachments: attachments,
            }, function(err, resp) {
              if (err || debug) bot.botkit.log(err, resp);
            });
          }
        }, {
          access_token: user.access_token,
          ids: listToString(jsonList, true)
        });
      }
    }, {
      access_token: user.access_token
    });
  });
});

/////PREFIX
helpFile.prefix = "Takes three arguments.\nOne: Returns a list of all item prefixes and their stats that contain that string.\nTwo (Optional):The character level at which the suffix is available. Note that level 60 prefixes start to show up on weapons (only) at level 52.\nThree (Optional): Filter results by that type. Valid types are: standard, gem, ascended, all. Defaults to standard. You can use abbreviations, but 'a' will be all.\nExamples: 'prefix berzerker 12 all' 'prefix pow gem' 'prefix pow 2 asc'";
helpFile.suffix = "Alias for prefix. ";

controller.hears(['prefix (.*)', 'suffix (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var matches = message.text.match(/(prefix|suffix) (\w+)\s?(\d{1,2})?\s?([a-zA-Z]*)$/i);
  var name = matches[2].trim();
  var level = matches[3];
  var type = (matches[4] ? matches[4].trim() : "");
  name = removePunctuationAndToLower(name);
  type = scrubType(removePunctuationAndToLower(type));
  var prefixes = prefixSearch(name, type, level);
  if (!prefixes || (Object.keys(prefixes).length) < 1)
    bot.reply(message, 'No match for \'' + name + '\' of type \'' + type + '\'. Misspell? Or maybe search all.');
  else {
    bot.reply(message, printPrefixes(prefixes));
  }
});

/////TOGGLE
controller.hears(['^toggle'], 'direct_message,direct_mention,mention', function(bot, message) {
  if (toggle) toggle = false;
  else toggle = true;
  bot.reply(message, "So toggled.");
});

helpFile.hello = "Lessdremoth will say hi back.";
helpFile.hi = "Lessdremoth will say hi back.";
controller.hears(['hello', 'hi'], 'direct_message,direct_mention,mention', function(bot, message) {
  if (message.user && message.user == 'U0T3J3J9W') {
    bot.reply(message, 'Farrrrt Pizza');
    addReaction(message, 'pizza');
    setTimeout(function() {
      addReaction(message, 'dash');
    }, 500);
  } else {
    bot.reply(message, 'Hello.');
    addReaction(message, 'robot_face');
  }
});

helpFile.shutdown = "Command Lessdremoth to shut down.";
controller.hears(['shutdown'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {

    convo.ask('Are you sure you want me to shutdown?', [{
      pattern: bot.utterances.yes,
      callback: function(response, convo) {
        convo.say('Bye!');
        convo.next();
        setTimeout(function() {
          process.exit();
        }, 3000);
      }
    }, {
      pattern: bot.utterances.no,
      default: true,
      callback: function(response, convo) {
        convo.say('*Phew!*');
        convo.next();
      }
    }]);
  });
});

helpFile.uptime = "Lessdremoth will display some basic uptime information.";
helpFile["who are you"] = "Lessdremoth will display some basic uptime information.";
controller.hears(['uptime', 'who are you'], 'direct_message,direct_mention,mention', function(bot, message) {

  var hostname = os.hostname();
  var uptime = formatUptime(process.uptime());

  bot.reply(message, ':frasier: I am a bot named <@' + bot.identity.name + '>. I have been running for ' + uptime + ' on ' + hostname + '.');

});


/////Easter Eggs
controller.hears(['my love for you is like a truck', 'my love for you is like a rock', 'my love for you is ticking clock'], 'direct_message,ambient', function(bot, message) {
  var name = 'berserker';
  var prefixes = prefixSearch(name);
  // if (prefixes)
  for (var key in prefixes) {
    bot.reply(message, key + ": " + listToString(prefixes[key]));
  }
});

prefixData.Nuprin = {
  "type": "standard",
  "minlevel": 0,
  "maxlevel": 20,
  "stats": ["Little", "Yellow", "Different"]
};

//Variables and callbacks used for loading data
var globalMessage;

var halfCallback = function(apiKey) {
  var end = new Date().getTime();
  var time = end - start;
  if (globalMessage) {
    bot.reply(globalMessage, "Half done loading the list of " + apiKey + ".");
  }
  bot.botkit.log("HALF " + apiKey + ": " + time + "ms");
};
var errorCallback = function(msg) {
  if (globalMessage) {
    bot.reply(globalMessage, "Oop. I got an error while loading data:\n" + msg + '\nTry loading again later.');
  }
  bot.botkit.log("error loading: " + msg);
  dataLoaded = false;
};
var doneCallback = function(apiKey) {
  var end = new Date().getTime();
  var time = end - start;
  if (globalMessage) {
    bot.reply(globalMessage, "Finished loading the list of recipes. Starting on items.");
  } else bot.botkit.log("DONE " + apiKey + ": " + time + "ms");
  gw2nodelib.forgeRequest(function(forgeList) {
    if (debug) bot.botkit.log("unfiltered forgeitems: " + forgeList.length);
    var filteredForgeList = forgeList.filter(removeInvalidIngredients);
    if (debug) bot.botkit.log((forgeList.length - filteredForgeList.length) + " invalid forge items");
    if (debug) bot.botkit.log("forgeitems: " + filteredForgeList.length);
    gw2nodelib.data.forged = gw2nodelib.data.forged.concat(filteredForgeList);
    bot.botkit.log("data has " + Object.keys(gw2nodelib.data.recipes).length + " recipes and " + Object.keys(gw2nodelib.data.forged).length + " forge recipes");
    //Go through recipes, and get the item id of all output items and recipe ingredients.
    var itemsCompile = compileIngredientIds();
    if (globalMessage) {
      bot.reply(globalMessage, "I need to fetch item data for " + Object.keys(itemsCompile).length + " ingredients.");
    }
    bot.botkit.log("Fetching " + Object.keys(itemsCompile).length + " ingredient items");

    var doneInner = function(apiKey) {
      if (globalMessage) {
        bot.reply(globalMessage, "Ingredient list from recipes loaded. I know about " + Object.keys(gw2nodelib.data.items).length + " ingredients for " + Object.keys(gw2nodelib.data.recipes).length + " recipes/" + Object.keys(gw2nodelib.data.forged).length + " forge recipes.");
      }
      var end = new Date().getTime();
      var time = end - start;
      bot.botkit.log("Item list from recipes loaded. Data has " + Object.keys(gw2nodelib.data.items).length + " items: " + time + "ms");
      dataLoaded = true;
      globalMessage = null;
    };
    gw2nodelib.load("items", {
      ids: Object.keys(itemsCompile)
    }, (globalMessage ? true : false), halfCallback, doneInner, errorCallback);
  });
};
var start = new Date().getTime();
gw2nodelib.load("recipes", {}, false, halfCallback, doneCallback, errorCallback);



///Helper functions

//Say scond uptime in nearest sane unit of measure
function formatUptime(uptime) {
  var unit = 'second';
  if (uptime > 60) {
    uptime = uptime / 60;
    unit = 'minute';
  }
  if (uptime > 60) {
    uptime = uptime / 60;
    unit = 'hour';
  }
  if (uptime >= 2) {
    unit = unit + 's';
  }

  uptime = uptime.toFixed(0) + ' ' + unit;
  return uptime;
}

//Quickload a datafile, like sass.json
function loadStaticDataFromFile(fileName) {
  return JSON.parse(fs.readFileSync(fileName, {
    encoding: 'utf8'
  }));
}

//Quicksave a datafile, like sass.json
function saveStaticDataToFile(fileName, obj) {
  fs.writeFile(fileName, JSON.stringify(obj));
}

//Find an arbitrary key/value pair in loaded data (gw2nodelib.data.apiKey)
function findInData(key, value, apiKey) {
  for (var i in gw2nodelib.data[apiKey]) {
    if (gw2nodelib.data[apiKey][i][key] == value) {
      return gw2nodelib.data[apiKey][i];
    }
  }
}

//add the given emoji to given message
function addReaction(message, emoji) {
  bot.api.reactions.add({
    timestamp: message.ts,
    channel: message.channel,
    name: emoji,
  }, function(err, res) {
    if (err) {
      bot.reply(message, "I'm having trouble adding reactions.");
      bot.botkit.log('Failed to add emoji reaction :(', err);
    }
  });
}

//Stringify keys in an array; used for helpfile
function listKeys(jsonArray) {
  if (debug) bot.botkit.log("jsonArray: " + JSON.stringify(jsonArray));
  var outstring = "";
  for (var key in jsonArray) {
    outstring += key + ", ";
  }
  return outstring.substring(0, outstring.length - 2);
}

//Stringify a list to just text and commas. Optionally skip trailing space
function listToString(jsonList, skipSpace) {
  //  if (debug) bot.botkit.log("jsonList: " + JSON.stringify(jsonList));
  var outstring = "",
    len = Object.keys(jsonList).length;
  for (var i = 0; i < len; i++) {
    outstring += jsonList[i];
    if (i !== len - 1) outstring += ",";
    if (!skipSpace) outstring += " ";
  }
  return outstring;
}

//////Prefix search helper functions. Prefix data looks like
//name = {"type": "standard", "stats": ["Little", "Yellow", "Different"] }
//Stringify a list of prefix data with its associated 'stats' with newline
function printPrefixes(prefixes) {
  var outMessage = "";
  for (var key in prefixes) {
    outMessage += key + ": " + listToString(prefixes[key].stats) + "\n";
  }
  return outMessage;
}

//Make sure the incoming string is 'standard', 'gem' 'all' or 'ascended'
function scrubType(type) {
  if (!type || type.length === 0) return 'standard';
  else if ('gem'.startsWith(type)) return 'gem';
  else if ('all'.startsWith(type)) return 'all';
  else if ('ascended'.startsWith(type)) return 'ascended';
  else return 'standard';
}

//Search the prfix data for searchTerm and type type
function prefixSearch(searchTerm, type, level) {
  var prefixList = {};
  type = scrubType(type);
  if (debug) bot.botkit.log("searching " + searchTerm + " of type " + type);
  findPrefixByName(searchTerm, type, prefixList);
  findPrefixesByStat(searchTerm, type, prefixList);
  filterPrefixesByLevel(prefixList, (level ? level : 80));
  return prefixList;
}

//Search given prefix data for matching name
function findPrefixByName(name, type, prefixList) {
  for (var key in prefixData) {
    var compare = removePunctuationAndToLower(key);
    if (prefixData.hasOwnProperty(key) && compare.indexOf(name) > -1 && (type == 'all' || prefixData[key].type == type)) {
      if (debug) bot.botkit.log("added key from name " + key);
      prefixList[key] = prefixData[key];
    }
  }
  if (debug) bot.botkit.log("Total after ByName search " + Object.keys(prefixList).length);
}

//Search given prefix data for matching stat
function findPrefixesByStat(stat, type, prefixList) {
  for (var key in prefixData) {
    if (prefixData.hasOwnProperty(key) && (type == 'all' || prefixData[key].type == type)) {
      for (var subKey in prefixData[key].stats) {
        var compare = removePunctuationAndToLower(prefixData[key].stats[subKey]);
        if (debug) bot.botkit.log("subkey " + prefixData[key].stats[subKey]);
        if (compare.indexOf(stat) === 0) {
          if (debug) bot.botkit.log("added key from stat " + key);
          prefixList[key] = prefixData[key];
          break;
        }
      }
    }
  }
  if (debug) bot.botkit.log("Total after ByStat search " + Object.keys(prefixList).length);
}

function filterPrefixesByLevel(prefixList, level) {
  for (var i in prefixList) {
    if (prefixList[i].minlevel > level || prefixList[i].maxlevel < level)
      delete prefixList[i];
  }
}

////////////////Recipe Lookup related functions
//For a given item, find its base ingredients and prepare an attachment displaying it
function assembleRecipeAttachment(itemToDisplay) {
  var ingredients;
  //is it a standard reci?pe
  var foundRecipe = findInData('output_item_id', itemToDisplay.id, 'recipes');
  if (foundRecipe) {
    ingredients = getBaseIngredients(foundRecipe.ingredients);
  } else { //mystic forge recipe. Do Not getBaseIngredients. Forge recipes that will shift the tier of the item means that most things will be reduced toa  giant pile of tier 1 ingredients
    var forgeRecipe = findInData('output_item_id', itemToDisplay.id, 'forged');
    if (forgeRecipe)
      ingredients = forgeRecipe.ingredients;
  }
  //Recipe not found.
  if (!ingredients) return [];
  //chat limitations in game means that pasted chatlinks AFTER EXPANSION are limited to 155 charachters
  //[&AgEOTQAA] is not 10 characters long, but rather 13 (Soft Wood Log)
  //gwPasteString is the actual series of chatlinks for pasting
  var gwPasteString = '';
  //gwlenght records the length of the names of the items
  var gwLength = 0;
  var attachments = [];
  var item;

  //if we'd go above 255 chars after expansion, put in a newline before adding on.
  var gwPasteStringMaxInt = function(addString) {
    if (gwLength > 254) {
      gwPasteString += '\n';
      gwLength = 0;
    }
    gwPasteString += addString;
  };

  if (toggle) { // display one

    var attachment = {
      color: '#000000',
      thumb_url: itemToDisplay.icon,
      fields: [],
      "fallback": itemToDisplay.name + " has " + ingredients.length + " items."
    };
    for (var i in ingredients) {
      item = findInData('id', ingredients[i].item_id, 'items');
      if (item) {
        gwLength += (" " + ingredients[i].count + "x[" + item.name + "]").length;
        gwPasteStringMaxInt(" " + ingredients[i].count + "x" + item.chat_link);
        attachment.fields.push({
          title: ingredients[i].count + " " + item.name + (item.level ? " (level " + item.level + ")" : ""),
          short: false
        });
      } else {
        gwLength += (" " + ingredients[i].count + " of unknown item id " + ingredients[i].item_id).length;
        gwPasteStringMaxInt(" " + ingredients[i].count + " of unknown item id " + ingredients[i].item_id);
        attachment.fields.push({
          title: ingredients[i].count + " of unknown item id " + ingredients[i].item_id,
          short: false
        });
      }
    }
    attachments.push(attachment);
  } else { // display two
    for (var j in ingredients) {
      item = findInData('id', ingredients[j].item_id, 'items');
      if (item) {
        gwPasteStringMaxInt(" " + ingredients[j].count + "x" + item.chat_link);
        attachments.push({
          "fallback": ingredients[j].count + "x" + item.name,
          "author_name": ingredients[j].count + " " + item.name,
          "author_link": "http://wiki.guildwars2.com/wiki/" + item.name.replace(/\s/g, "_"),
          "author_icon": item.icon
        });
      } else {
        gwPasteStringMaxInt(" " + ingredients[j].count + " of unknown item id " + ingredients[j].item_id);
        attachments.push({
          "fallback": ingredients[j].count + " of unknown item id " + ingredients[j].item_id,
          "author_name": ingredients[j].count + " of unknown item id " + ingredients[j].item_id
        });
      }
    }
  }
  // attachments[0].pretext = gwPasteString;
  attachments.push({
    color: '#2200EE',
    fields: [{
      value: gwPasteString
    }]
  });
  return attachments;
}

//for string 'normalization before comparing in searches'
function removePunctuationAndToLower(string) {
  var punctuationless = string.replace(/['!"#$%&\\'()\*+,\-\.\/:;<=>?@\[\\\]\^_`{|}~']/g, "");
  var finalString = punctuationless.replace(/\s{2,}/g, " ");
  return finalString.toLowerCase();
}

//normalizes input string and searches regular and forge recipes for an item match. Matches if search term shows up anywhere in the item name
function findCraftableItemByName(searchName) {
  var itemsFound = [];
  var cleanSearch = removePunctuationAndToLower(searchName);
  if (debug) bot.botkit.log("findCraftableItemByName: " + cleanSearch);
  for (var i in gw2nodelib.data.items) {
    cleanItemName = removePunctuationAndToLower(gw2nodelib.data.items[i].name);
    if (debug && i == 1) bot.botkit.log("Sample Item: " + cleanItemName + '\n' + JSON.stringify(gw2nodelib.data.items[i]));
    if (cleanItemName.includes(cleanSearch)) {
      if (findInData('output_item_id', gw2nodelib.data.items[i].id, 'recipes')) {
        itemsFound.push(gw2nodelib.data.items[i]);
      } else if (findInData('output_item_id', gw2nodelib.data.items[i].id, 'forged')) {
        var forgedItem = gw2nodelib.data.items[i];
        forgedItem.forged = true;
        itemsFound.push(forgedItem);
      } else if (debug) bot.botkit.log('Found an item called ' + gw2nodelib.data.items[i].name + ' but it is not craftable');
    }
  }
  return itemsFound;
}

function getBaseIngredients(ingredients) {

  //Adds or increments ingredients
  var addIngredient = function(existingList, ingredientToAdd) {
    //ingredient format is {"item_id":19721,"count":1}
    for (var i in existingList) {
      if (existingList[i].item_id == ingredientToAdd.item_id) {
        var n = ingredientToAdd.count;
        existingList[i].count += n;
        return;
      }
    }
    //not in list, add to the end.
    existingList.push(ingredientToAdd);
  };
  //ingredient format is {"item_id":19721,"count":1}
  var baseIngredients = []; //ingredients to send back, unmakeable atoms
  var extraIngredients = []; //extra items left over after producing (usually a refinement)
  //Ex1: mighty bronze axe (simple) 1 weak blood, 1 blade (3 bars (10 copper, 1 tin)), one haft (two planks(6 logs))
  for (var i = 0; i < ingredients.length; i++) { //Length changes. Careful, friend
    var makeableIngredient = findInData('output_item_id', ingredients[i].item_id, 'recipes');
    if (!makeableIngredient) { //if it's not made, base ingredient 
      if (debug) bot.botkit.log(findInData('id', ingredients[i].item_id, 'items').name + " is a base ingredient "); //Ex1: 1 vial of blood
      addIngredient(baseIngredients, ingredients[i]);
    } else { //Ex1: an axe blade
      if (debug) bot.botkit.log("need " + ingredients[i].count + " of " + findInData('id', ingredients[i].item_id, 'items').name + '(' + makeableIngredient.output_item_count + ')');
      //Add parts of this sub-recipe to the ingredients list
      var ingredientsNeeded = ingredients[i].count; //How many of this sub recipe to make
      var listItem;
      if (debug) listItem = findInData('id', ingredients[i].item_id, 'items').name;
      //Check if we have any in extra ingredients
      if (debug) bot.botkit.log('see if we already have any of the ' + ingredientsNeeded + ' ' + listItem + '(s) we need');
      for (var x in extraIngredients) {
        if (debug) bot.botkit.log("we have " + extraIngredients[x].count + " " + findInData('id', extraIngredients[x].item_id, 'items').name);
        if (extraIngredients[x].item_id == makeableIngredient.output_item_id) { //we've already made some
          if (ingredientsNeeded >= extraIngredients[x].count) { //we don't have enough, add what we have to the 'made' pile
            ingredientsNeeded -= extraIngredients[x].count;
            extraIngredients.splice(x, 1); //remove the 'used' extra ingredients
            if (debug) bot.botkit.log("that was it for extra " + listItem);
          } else {
            extraIngredients[x].count -= ingredientsNeeded; //we have more than enough, subtract what we used.
            ingredientsNeeded = 0; // we need make no more
            if (debug) bot.botkit.log("had enough spare " + listItem);
          }
        }
      }
      if (ingredientsNeeded > 0) { //Do we still need to make some after our extra ingredients pass?
        var numToMake = Math.ceil(ingredientsNeeded / makeableIngredient.output_item_count); //Ex 1: need 3, makes 5 so produce once.
        if (debug) bot.botkit.log("still need " + ingredientsNeeded + " " + listItem + ". making " + numToMake);
        //Calculate number of times to make the recipe to reach ingredientsNeeded
        //add all its parts times the number-to-make to the ingredient list for processing
        for (var n in makeableIngredient.ingredients) { //Ex1: add 10 copper and 1 tin to ingredients
          var singleComponent = {
            item_id: makeableIngredient.ingredients[n].item_id,
            count: (makeableIngredient.ingredients[n].count * numToMake) //Unqualified multiplication. Hope we're not a float
          };
          ingredients = ingredients.concat([singleComponent]); //add this to the end of the list of ingredients, if it has sub components, we'll get to them there
        }
        var excessCount = (makeableIngredient.output_item_count * numToMake) - ingredientsNeeded; //Ex1: made 5 bars, need 3
        if (excessCount > 0) { //add extra to a pile
          addIngredient(extraIngredients, { //EX1: add two here
            item_id: makeableIngredient.output_item_id,
            count: excessCount
          });
        }
      }
    }
  }
  if (debug) {
    bot.botkit.log("extra pile is:");
    for (var j in extraIngredients) {
      var item2 = findInData('id', extraIngredients[j].item_id, 'items');
      if (item2)
        bot.botkit.log(extraIngredients[j].count + " " + item2.name);
      else
        bot.botkit.log('Unknown Item of id: ' + extraIngredients[j].item_id + '(' + extraIngredients[j].count + ')');
    }
  }
  return baseIngredients; //return our list of non-makeable ingredients
}

//Scour through recipes and forge recipes for output item/ingredient item ids. Return a no-duplicate list of these.
function compileIngredientIds() {
  itemsCompile = {};
  for (var t in gw2nodelib.data.recipes) {
    itemsCompile[gw2nodelib.data.recipes[t].output_item_id] = 1;
    //        if(gw2nodelib.data.recipes[t].output_item_id < 1) bot.botkit.log("compile found: "+JSON.stringify(gw2nodelib.data.recipes[t]));
    for (var i in gw2nodelib.data.recipes[t].ingredients) {
      itemsCompile[gw2nodelib.data.recipes[t].ingredients[i].item_id] = 1;
      //      if(gw2nodelib.data.recipes[t].ingredients[i].item_id < 1) bot.botkit.log("compile found: "+JSON.stringify(gw2nodelib.data.recipes[t]));
    }
  }
  for (var f in gw2nodelib.data.forged) {
    itemsCompile[gw2nodelib.data.forged[f].output_item_id] = 1;
    //        if(gw2nodelib.data.forged[f].output_item_id < 1) bot.botkit.log("compile found: "+JSON.stringify(gw2nodelib.data.forged[f]));
    for (var g in gw2nodelib.data.forged[f].ingredients) {
      itemsCompile[gw2nodelib.data.forged[f].ingredients[g].item_id] = 1;
      //      if(gw2nodelib.data.forged[f].ingredients[g].item_id < 1) bot.botkit.log("compile found: "+JSON.stringify(gw2nodelib.data.forged[f]));
    }
  }
  return itemsCompile;
}

//filter function for recipes. Removes invalid output items id and invalid ingredient ids
function removeInvalidIngredients(value, index, array) {
  //Negative ids, output_item_ids and ingredient.item_ids are invalid
  if (value.id && value.id < 1) return false;
  if (value.output_item_id && value.output_item_id < 1) return false;
  for (var j in value.ingredients) {
    if (value.ingredients[j].item_id && value.ingredients[j].item_id < 1) return false;
  }
  return true;
}