//Achievement related commadns for lessdremoth
//Author: Roger Lampe roger.lampe@gmail.com
var sf = require('./sharedFunctions.js');
var gw2api = require('./api.js');
var debug = false;
var toggle = true;
var currentUserAccessToken;

function compileDailyAchievements(todayList, isFractals) {
  var dayfields = [];
  var fractalTiersSeen = {};

  for (var d in todayList) {
    var day = gw2api.findInData('id', todayList[d].id, 'achievements');
    var dayLabel;
    if (day && day.name) {
      if (isFractals && day.name.indexOf('Tier') >=0) { //daily tiers need only be printed once i.e. Daily Tier 1 Thaumanova Reactor
        var matches = day.name.match(/\s*Daily\sTier\s(\d*)\s(.*)/i);
        if (!matches) { //weird non-match, skip it
          sf.log("Unrecognized fractal: " + day.name);
          continue;
        }
        var fractalName = matches[2];
        if (fractalTiersSeen[fractalName]) { //repeat, don't add
          continue;
        } else {
          fractalTiersSeen[fractalName] = 1;
          dayLabel = "Daily Tier 1-4 " + fractalName;
        }
      } else {
        dayLabel = day.name;
      }
      if (todayList[d].required_access.length == 1)
        dayLabel += (todayList[d].required_access[0] == 'GuildWars2' ? ' (Old World)' : ' (HoT)');
    } else dayLabel = "Nameless Achievement - id  " + todayList[d].id;
    dayfields.push({
      //            "title": ,
      "value": dayLabel,
      "short": false
    });
  }
  return dayfields;
}

//find an achievement in the freshly fetched account achievements by id
function findInAccount(id, accountAchievements) {
  for (var t in accountAchievements) {
    if (accountAchievements[t].id == id) {
      return accountAchievements[t];
    }
  }
}

//must be a category Just pick a cheevo at random from the category
function displayRandomCheevoCallback(cheevoToDisplay) {
  if (debug) sf.log("Display random cheevo: " + cheevoToDisplay.name);
  var randomNum;
  var alreadyDone = true;
  var acctCheevo;
  var subcheevoList = [];
  var isBits = false;
  if (cheevoToDisplay.achievements) { //choose random achievement from sub category
    subcheevoList = cheevoToDisplay.achievements.slice();
  } else if (cheevoToDisplay.bits) { //choose random part of an achievement
    subcheevoList = cheevoToDisplay.bits.slice();
    isBits = true;
    if (debug) sf.log("bits cheevo:" + JSON.stringify(acctCheevo));
  } else {
    sf.replyWith("Sorry, that particular achievement has no parts to randomly choose from.\n...from which to randomly choose. Whatever.");
    return;
  }
  var lookuplist = isBits ? [cheevoToDisplay.id] : subcheevoList;

  if (debug) sf.log("number of subparts:" + subcheevoList.length + ". isBits is " + isBits);
  gw2api.promise.accountAchievements(lookuplist, currentUserAccessToken)
    .then(function(res) {
      var accountAchievements = res;
      if (debug) sf.log("random cheevo lookup result length: " + accountAchievements.length);
      if (isBits) acctCheevo = findInAccount(cheevoToDisplay.id, accountAchievements);

      while (alreadyDone && subcheevoList.length > 0) {
        randomNum = Math.floor(Math.random() * subcheevoList.length);
        if (!isBits) acctCheevo = findInAccount(subcheevoList[randomNum], accountAchievements); //categories are a new cheevo each loop
        if (!isBits && debug) sf.log("nonbits cheevo:" + (typeof JSON.stringify(acctCheevo) == 'undefined' ? "undone cheevo " + subcheevoList[randomNum] : JSON.stringify(acctCheevo)));
        //keep picking until we find one the user has not done.
        if (typeof acctCheevo != 'undefined' && cheevoIsDone(acctCheevo, randomNum)) { //remove from list so we can't choose it again
          subcheevoList.splice(randomNum, 1);
          if (debug) sf.log("Removed cheevo. New length:" + subcheevoList.length);
        } else {
          alreadyDone = false;
        }
      }
      if (subcheevoList.length < 1) {
        sf.replyWith("You've done them all, " + sf.randomOneOf(["genius", "smartass", "silly", "stupid", "you monster", "tiger", "princess", "sport"]) + ".");
      } else {
        if (isBits) {
          sf.replyWith("Go forth and get...\n" + displayAchievementBit(subcheevoList[randomNum]));
        } else {
          var randomCheevo = gw2api.findInData('id', subcheevoList[randomNum], 'achievements'); //find the achievement to get the name
          //replace descriptions ending in periods with exclamation points for MORE ENTHSIASM
          var desc = randomCheevo.description.replace(/(\.)$/, '');
          desc += '!';
          var url = "http://wiki.guildwars2.com/wiki/" + randomCheevo.name.replace(/\s/g, "_");
          sf.replyWith("Go do '" + randomCheevo.name + "'." + (desc.length > 1 ? "\n" + desc : '') + "\n" + url);
        }
      }
    }).catch(function(error) {
      sf.replyWith("I got an error on my way to promise land from random cheevos. Send help!\nTell them " + error);
    });
}

function cheevoIsDone(cheevo, bitNum) { //this exists because the data is not flippin' consistant
  if (typeof cheevo.done != 'undefined' && cheevo.done === true) return true;
  if (typeof cheevo.current == 'number' && typeof cheevo.max == 'number' && cheevo.current >= cheevo.max) return true;
  if (typeof cheevo.bits != 'undefined' && typeof bitNum != 'undefined' && cheevo.bits.indexOf(bitNum) >= 0) return true;
  return false;
}

function displayCategoryCallback(categoryToDisplay) {
  if (debug) console.log("Display category cheevo: " + categoryToDisplay.name);

  //go through each achievement in the category, get name, if done by user: sum progress
  var numDone = 0;
  var totalAchievements = categoryToDisplay.achievements.length;
  var partsCurrentSum = 0;
  var partsMaxSum = 0;
  var achievementTextList = [];
  gw2api.promise.accountAchievements(categoryToDisplay.achievements, currentUserAccessToken)
    .then(function(res) {
      var accountAchievements = res;
      if (debug) sf.log("category cheevo lookup result: " + JSON.stringify(accountAchievements));

      for (var a in categoryToDisplay.achievements) {
        var gameAchievement = gw2api.findInData('id', categoryToDisplay.achievements[a], 'achievements');
        if (!gameAchievement) { //if we don't have the game data, skip it
          achievementTextList.push("No Achievement found in data - id  " + categoryToDisplay.achievements[a]);
          continue;
        }
        var name = 'Nameless Achievement';
        var doneProgress = '';
        var repeat = '';
        if (gameAchievement.name) name = gameAchievement.name;
        var acctCheevo = findInAccount(categoryToDisplay.achievements[a], accountAchievements);
        if (acctCheevo && typeof acctCheevo.current == 'number' && typeof acctCheevo.max == 'number') {
          if (typeof acctCheevo.repeated == 'number' && acctCheevo.repeated > 0) {
            repeat = " (repeated " + (acctCheevo.repeated > 1 ? acctCheevo.repeated + " times" : 'once') + ")";
            //on a repeat, add to the total as if we've done it once, despite current progress
            partsCurrentSum += acctCheevo.max;
          } else {
            //otehrwise, add our current progress to it.
            partsCurrentSum += acctCheevo.current;
          }
          partsMaxSum += acctCheevo.max;
          doneProgress = " - " + acctCheevo.current + "/" + acctCheevo.max;
          if (acctCheevo.done || repeat.length > 0) {
            numDone++;
            if (typeof acctCheevo.repeated != 'number' || acctCheevo.repeated <= 0) //append 'done' if we're not mid-repeat.
              doneProgress += ' (Done)';
          }
        } else //not done/progressed, add highest tier count as a 'max' and show 0 of that amount
        if (gameAchievement.tiers) {
          var tierMax = gameAchievement.tiers[gameAchievement.tiers.length - 1].count;
          doneProgress = " - 0/" + tierMax;
          partsMaxSum += tierMax;
        }

        achievementTextList.push(name + doneProgress + repeat);
      }
      var pretext = '';
      var fields = [];

      title = categoryToDisplay.name + " Report";
      if (partsCurrentSum > 0)
        fields.push({
          title: "Total" + (numDone + totalAchievements > 0 ? ': ' + numDone + ' of ' + totalAchievements : ''),
          value: "You've done " + partsCurrentSum + " out of " + partsMaxSum + " parts (" + Math.floor(partsCurrentSum / partsMaxSum * 100) + "%).\nRepeats count as their max value."
        });

      sf.log("Cheevo category title: " + title);
      var attachment = { //assemble attachment
        fallback: title,
        pretext: pretext,
        //example: Dungeon Frequenter Report 5 of 8 - Done 4 times
        title: title,
        color: '#AA129F',
        thumb_url: (categoryToDisplay.icon ? categoryToDisplay.icon : "https://wiki.guildwars2.com/images/d/d9/Hero.png"),
        fields: fields,
        text: achievementTextList.join('\n')
      };
      sf.replyWith({
        text: '',
        attachments: [attachment]
      });
    }).catch(function(error) {
      sf.replyWith("I got an error on my way to promise land from cheevo categories. Send help!\nTell them " + error);
    });
}

function lookupCheevoParts(cheevoToDisplay, isFull, callback) {
  if (debug) console.log("Lookup cheevo parts");
  var skinsToFetch = [];
  var titlesToFetch = [];
  var minisToFetch = [];
  var itemsToFetch = [];

  var searchList = [];
  if (typeof cheevoToDisplay.bits != 'undefined')
    searchList = searchList.concat(cheevoToDisplay.bits);
  if (typeof cheevoToDisplay.rewards != 'undefined' && isFull)
    searchList = searchList.concat(cheevoToDisplay.rewards);
  //collate list of things to fetch
  for (var b in searchList) {
    if (searchList[b].id) {
      var searchId = searchList[b].id;
      switch (searchList[b].type) {
        case "Skin":
          skinsToFetch.push(searchId);
          break;
        case "Title":
          titlesToFetch.push(searchId);
          break;
        case "Minipet":
          minisToFetch.push(searchId);
          break;
        case "Item":
          itemsToFetch.push(searchId);
      }
    }
  }
  if (debug) console.log(skinsToFetch.length + " skins to fetch\n" +
    titlesToFetch.length + " titles to fetch\n" +
    minisToFetch.length + " minis to fetch\n" +
    itemsToFetch.length + " items to fetch");
  Promise.all([gw2api.promise.skins(skinsToFetch), gw2api.promise.titles(titlesToFetch), gw2api.promise.minis(minisToFetch), gw2api.promise.items(itemsToFetch)])
    .then(function(results) {
      fetchFreshData = results;
      callback(cheevoToDisplay, isFull);
    }).catch(function(error) {
      sf.replyWith("I got an error on my way to promise land from cheevo parts. Send help!\nTell them " + error);
    });
}

function displayCheevoCallback(cheevoToDisplay, isFull) {
  if (debug) sf.log("Display cheevo " + cheevoToDisplay.name + ", isfull: " + isFull);
  //setup all but the bits
  var pretext = '';
  gw2api.promise.accountAchievements([cheevoToDisplay.id], currentUserAccessToken)
    .then(function(res) {
      var acctCheevo = res[0];
      if (debug) sf.log("user cheevo lookup result: " + JSON.stringify(acctCheevo));
      var currentPartsDone = 0;

      //max is the count of the highest tier, not just the sum ob the bits.
      var maxParts = (cheevoToDisplay.tiers && cheevoToDisplay.tiers[cheevoToDisplay.tiers.length - 1].count > 1 ? cheevoToDisplay.tiers[cheevoToDisplay.tiers.length - 1].count : 0);
      var repeat = '';
      if (acctCheevo) {
        if (typeof acctCheevo.current == 'number') currentPartsDone = acctCheevo.current;
        if (typeof acctCheevo.max == 'number') maxParts = acctCheevo.max;
        if (typeof acctCheevo.repeated == 'number' && acctCheevo.repeated > 0) repeat = ", repeated " + (acctCheevo.repeated > 1 ? acctCheevo.repeated + " times" : 'once');
      }
      var title = cheevoToDisplay.name + " Report";
      var text = '';

      //Load bits to desplay into data first.
      var cheevoBits = [];
      for (var b in cheevoToDisplay.bits) {
        var doneFlag = false;
        if (acctCheevo && acctCheevo.bits) {
          if (acctCheevo.bits.indexOf(Number(b)) >= 0) {
            doneFlag = true;
          }
        }
        cheevoBits.push(displayAchievementBit(cheevoToDisplay.bits[b], doneFlag));
      }
      var fields = [];

      var totalString = '';
      if (maxParts > 1)
        totalString = "Total: " + currentPartsDone + ' of ' + maxParts + " (" + (Math.floor(currentPartsDone / maxParts * 100) > 100 ? '100' : Math.floor(currentPartsDone / maxParts * 100)) + "%)" + repeat;
      else
        totalString = (acctCheevo && acctCheevo.done ? "" : "Not ") + "Complete" + repeat;
      var summaryField = {
        title: totalString,
        value: ''
      };

      if (cheevoToDisplay.description.length > 0)
        summaryField.value += "\nDescription: " + sf.replaceGWFlavorTextTags(cheevoToDisplay.description);
      if (cheevoToDisplay.requirement.length > 0)
        summaryField.value += "\nRequirement: " + sf.replaceGWFlavorTextTags(cheevoToDisplay.requirement);

      fields.push(summaryField);

      if (cheevoToDisplay.tiers && isFull) { //there's aways a tiers, but whatever.
        var tierField = {
          title: 'Tiers',
          value: '#\tPoints'
        };
        for (var tier in cheevoToDisplay.tiers) {
          tierField.value += '\n' + cheevoToDisplay.tiers[tier].count + "\t" + cheevoToDisplay.tiers[tier].points;
        }

        fields.push(tierField);
      }

      if (cheevoToDisplay.rewards && isFull) {
        var rewardField = {
          title: "Rewards",
          value: ""
        };
        for (var reward in cheevoToDisplay.rewards) {
          rewardField.value += '\n' + displayAchievementBit(cheevoToDisplay.rewards[reward]);
        }
        fields.push(rewardField);
      }

      if (!toggle) {
        //raw data for debug
        fields.push({
          title: "Raw Cheevo",
          value: JSON.stringify(cheevoToDisplay)
        });
        //raw data for debug
        fields.push({
          title: "Raw Progress",
          value: (acctCheevo ? JSON.stringify(acctCheevo) : "Not done")
        });
      }

      var attachment = { //assemble attachment
        fallback: title,
        pretext: pretext,
        //example: Dungeon Frequenter Report 5 of 8 - Done 4 times
        title: title,
        color: '#F0AC1B',
        thumb_url: getIconForParentCategory(cheevoToDisplay),
        fields: fields,
        text: text + "\n" + cheevoBits.join('\n')
      };
      sf.log("Cheevo title: " + title);
      sf.replyWith({
        text: '',
        attachments: [attachment]
      });
    }).catch(function(error) {
      sf.replyWith("I got an error on my way to promise land from cheevos. Send help!\nTell them " + error);
    });

}

function getIconForParentCategory(cheevo) {
  if (cheevo.icon) return cheevo.icon;
  else {
    for (var cat in gw2api.data.achievementsCategories) {
      if (gw2api.data.achievementsCategories[cat].achievements.indexOf(cheevo.id) >= 0 && gw2api.data.achievementsCategories[cat].icon)
        return gw2api.data.achievementsCategories[cat].icon;
    }
  }
  //default
  return "https://wiki.guildwars2.com/images/d/d9/Hero.png";
}

var fetchFreshData = []; //filled by promise fetch in Display cheevo call back
function displayAchievementBit(bit, doneFlag, data) {

  //covers achievement bits and rewards. Rewards have a count
  //Types are:
  //Text: simple text
  //Item and id {"type":"Item","id":78252,"count":1}
  //Coins: a count of coins (in copper) {"type":"Coins","count":50000}]}
  //mastery Tyria or maguuma {"type": "Mastery","region": "Tyria"}
  //Skin and id (no count) {"type": "Skin","id": 208}
  //Minipet and id (no count) {"type": "Minipet","id": 12}

  var skinData = fetchFreshData[0];
  var titleData = fetchFreshData[1];
  var miniData = fetchFreshData[2];
  var itemData = fetchFreshData[3];

  if (bit.type == 'Text')
    return bit.text + (doneFlag ? " - DONE" : '');
  else if (bit.type == 'Coins') {
    return "Coins: " + sf.coinToString(bit.count);
  } else if (bit.type == 'Mastery')
    return bit.region + " " + bit.type;
  else if (bit.type == 'Item') {
    var foundItem;
    for (var it in itemData) {
      if (bit.id == itemData[it].id) {
        foundItem = itemData[it];
        break;
      }
    }
    var itemType = ''; //weapon, armor, bag, etc
    if (foundItem && foundItem.type) {
      itemType = " (" + foundItem.type;
      if (foundItem.type != 'Container' && foundItem.details && foundItem.details.type) itemType += ": " + (foundItem.details.weight_class ? foundItem.details.weight_class + " " : "") + foundItem.details.type;
      itemType += ")";
      return foundItem.name + itemType + (bit.count && bit.count > 1 ? ', ' + bit.count : '') + (doneFlag ? " - DONE" : '');
    } else {
      return "Unknown item: " + bit.id + (doneFlag ? " - DONE" : '');
    }
  } else if (bit.type == 'Skin') {
    var foundSkin;
    for (var sk in skinData) {
      if (bit.id == skinData[sk].id) {
        foundSkin = skinData[sk];
        break;
      }
    }
    if (foundSkin) {
      var type = (foundSkin.details ? foundSkin.details.type : foundSkin.type);
      var weight = (foundSkin.details && foundSkin.details.weight_class ? foundSkin.details.weight_class : '');
      return foundSkin.name + " (" + (weight.length > 0 ? weight + " " : "") + type + " skin)" + (doneFlag ? " - DONE" : '');
    } else {
      return "Unknown skin: " + bit.id + (doneFlag ? " - DONE" : '');
    }
  } else if (bit.type == 'Title') {
    var foundTitle;
    for (var ti in titleData) {
      if (bit.id == titleData[ti].id) {
        foundTitle = titleData[ti];
        break;
      }
    }
    if (foundTitle) {
      var cheevoName = 'unknown achievement';
      var foundCheevo = gw2api.findInData('id', foundTitle.achievement, 'achievements');
      if (foundCheevo) cheevoName = foundCheevo.name;
      return foundTitle.name; // + " (Title from " + cheevoName + ")";
    } else {
      return "Unknown title: " + bit.id + (doneFlag ? " - DONE" : '');
    }
  } else if (bit.type == 'Minipet') {
    var foundMini;
    for (var mi in miniData) {
      if (bit.id == miniData[mi].id) {
        foundMini = miniData[mi];
        break;
      }
    }
    if (foundMini) {
      return foundMini.name;
    } else {
      return "Unknown Minipet: " + bit.id + (doneFlag ? " - DONE" : '');
    }
  } else return bit.type + ': ' + bit.id + (doneFlag ? " - DONE" : '');
}



module.exports = function() {
  var ret = {
    addResponses: function(controller) {
      controller.hears(['^cheevo(.*)', '^cheevor(.*)', '^cheevof(.*)'], 'direct_message,direct_mention,mention,ambient', function(bot, message) {
        //precheck: account achievements loaded 
        if (!gw2api.loaded.achievements || !gw2api.loaded.achievementsCategories) {
          bot.reply(message, "I'm still loading achievement data. Please check back in a couple of minutes. If this keeps happening, try 'db reload'.");
          sf.setGlobalMessage(message);
          return;
        }
        //fetch access token from storage
        controller.storage.users.get(message.user, function(err, user) {
          if (err) {
            bot.reply(message, "I got an error loading your data (or you have no access token set up). Try again later");
            bot.botkit.log("Error:cheevo no user data " + JSON.stringify(err));
            return;
          }
          var lookupSass = [
            'let me get right on that for you.',
            'I am sworn to look up your achievements.',
            "I'll check.",
            "let's do this.",
            "I'm on it.",
            "I guess I can."
          ];
          bot.reply(message, "Okay, " + user.dfid + sf.randomHonoriffic(user.dfid, user.id) + ", " + sf.randomOneOf(lookupSass));

          //precheck - input scrub a bit
          var matches = sf.removePunctuationAndToLower(message.text).match(/(cheevor|cheevof|cheevo)\s?([\s\w]*)$/i);
          if (!matches || !matches[2]) {
            bot.reply(message, "I didn't quite get that. Maybe ask \'help " + (isRandom ? 'cheevor' : 'cheevo') + "\'?");
            return;
          }
          var isRandom = matches[1] == 'cheevor';
          var isFull = matches[1] == 'cheevof';

          //precheck: access token.
          if (!user || !user.access_token || !sf.userHasPermission(user, 'progression')) {
            bot.botkit.log('ERROR: cheevo no access token: ' + JSON.stringify(user) + "err: " + JSON.stringify(err));
            bot.reply(message, "Sorry, I don't have your access token " + (user && user.access_token && !sf.userHasPermission(user, 'progression') ? "with correct 'progression' permissions " : "") + "on file. Direct message me the phrase \'access token help\' for help.");
            return;
          }
          currentUserAccessToken = user.access_token;
          //precheck: account acievements
          // gw2api.accountAchievements(function(accountAchievements) {
          //   if (accountAchievements.text || accountAchievements.error) {
          //     bot.reply(message, "Oops. I got an error when asking for your achievements.\nTry again later, it'll probably be fine.");
          //     bot.botkit.log("Account fetch error for user " + message.user + "." + (accountAchievements.text ? " Text:" + accountAchievements.text : '') + (accountAchievements.error ? "\nError:" + accountAchievements.error : ''));
          //     return;
          //   }
          var accountAchievements = 'dummy';
          cheevoSearchString = matches[2].replace(/\s+/g, '');
          if (debug) console.log("Cheevo searching: " + cheevoSearchString);
          //Look up the string.
          var cheevoToDisplay; //try a loop with contains
          var possibleMatches = [];
          var exactMatches = [];
          for (var c in gw2api.data.achievementsCategories) {
            var cheeCat = gw2api.data.achievementsCategories[c];
            if (cheeCat.name) {
              var cleanCat = sf.removePunctuationAndToLower(cheeCat.name).replace(/\s+/g, '');
              if (cleanCat == cheevoSearchString) {
                exactMatches.push(cheeCat);
                break;
              } else if (cleanCat.includes(cheevoSearchString))
                possibleMatches.push(cheeCat);
            }
          }
          for (var ch in gw2api.data.achievements) {
            var chee = gw2api.data.achievements[ch];
            if (chee.name) {
              var cleanChee = sf.removePunctuationAndToLower(chee.name).replace(/\s+/g, '');
              if (cleanChee == cheevoSearchString) {
                exactMatches.push(chee);
                break;
              } else if (cleanChee.includes(cheevoSearchString))
                possibleMatches.push(chee);
            }
          }
          if (debug) console.log("Found " + possibleMatches.length + " possible matches and " + exactMatches.length + " exact matches");
          if (exactMatches.length > 0) //cutout for categories or achievements with exact names.
            possibleMatches = exactMatches;
          if (possibleMatches.length < 1) {
            bot.reply(message, "No Achievements or Achievement Categories contain that phrase.  ¯\\_(ツ)_/¯");
            return;
          } else if (possibleMatches.length == 1) {
            sf.setGlobalMessage(message);
            if (possibleMatches[0].achievements && !isRandom) displayCategoryCallback(possibleMatches[0]);
            else lookupCheevoParts(possibleMatches[0], isFull, (isRandom ? displayRandomCheevoCallback : displayCheevoCallback));
          } else if (possibleMatches.length > 10) {
            var itemNameList = [];
            for (var n in possibleMatches)
              itemNameList.push(possibleMatches[n].name);
            bot.reply(message, {
              attachments: [{
                fallback: 'Too many achievements found in search.',
                text: "Woah. I found " + possibleMatches.length + ' achievements. Get more specific.\n' + itemNameList.join("\n")
              }]
            });
          } else {
            bot.startConversation(message, function(err, convo) {
              var askNum = 2;
              var listofItems = '';
              for (var i in possibleMatches) {
                var descString = '';
                if (possibleMatches[i].requirement) {
                  descString = possibleMatches[i].requirement;
                } else if (possibleMatches[i].description) {
                  descString = possibleMatches[i].description;
                } else if (possibleMatches[i].achievements) {
                  descString = 'Category with ' + possibleMatches[i].achievements.length + ' achievements.';
                }
                if (descString.length > 32) {
                  descString = descString.slice(0, 32);
                  descString += '...';
                }

                listofItems += '\n' + [i] + ": " + possibleMatches[i].name + (descString ? " - " + descString : '');
              }
              convo.ask('I found multiple achievements with that name. Which number you mean? (say no to quit)' + listofItems, [{
                //number, no, or repeat
                pattern: new RegExp(/^(\d{1,2})/i),
                callback: function(response, convo) {
                  //if it's a number, and that number is within our search results, print it
                  var matches = response.text.match(/^(\d{1,})/i);
                  var selection = matches[0];
                  if (selection < possibleMatches.length) {
                    sf.setGlobalMessage(convo);
                    if (possibleMatches[selection].achievements && !isRandom) displayCategoryCallback(possibleMatches[selection]);
                    else lookupCheevoParts(possibleMatches[selection], isFull, (isRandom ? displayRandomCheevoCallback : displayCheevoCallback));
                  } else if (askNum-- > 0) {
                    convo.say("Choose a valid number.");
                    convo.repeat();
                  } else
                    convo.say("Oh well.");
                  convo.next();
                }
              }, {
                //negative response. Stop repeating the list.
                pattern: bot.utterances.no,
                callback: function(response, convo) {
                  convo.say('¯\\_(ツ)_/¯');
                  convo.next();
                }
              }, {
                default: true,
                callback: function(response, convo) {
                  // loop back, user needs to pick or say no.
                  if (askNum-- > 0) {
                    convo.say("Choose a number of the achievement you'd like to see.");
                    convo.repeat();
                  } else
                    convo.say("Be serious.");
                  convo.next();
                }
              }]);
            });
          }
          // }, {
          //   access_token: user.access_token
          // }, true);
        });
      });

      controller.hears(['^daily$', '^today$', '^tomorrow$', '^fractals$', '^fractalstoday$', '^fractalstomorrow$'], 'direct_message,direct_mention,mention,ambient', function(bot, message) {
        if (!gw2api.loaded.achievements) { //still loading
          bot.reply(message, "I'm still loading achievement data. Please check back in a couple of minutes. If this keeps happening, try 'db reload'.");
          sf.setGlobalMessage(message);
          return;
        }

        var printToday = true;
        var printTomorrow = true;
        var sublist = 'pve';
        if (debug) sf.log("input:" + message.text.toLowerCase());
        if (message.text.toLowerCase().indexOf('today') >= 0) {
          printTomorrow = false;
        }
        if (message.text.toLowerCase().indexOf('tomorrow') >= 0) {
          printToday = false;
        }
        if (message.text.toLowerCase().indexOf('fractals') >= 0) {
          sublist = 'fractals';
        }
        if (debug) sf.log("switches: sublist=" + sublist + " printtoday:" + printToday + " printTomorrow: " + printTomorrow);

        var levelEightiesOnly = function(arrayItem) {
          return arrayItem.level.max == 80;
        };

        var todayList;
        var tomorrowList;

        var dailyPromises = [];
        if (printToday) dailyPromises.push(gw2api.promise.dailies(["all"]));
        if (printTomorrow) dailyPromises.push(gw2api.promise.dailiesTomorrow(["all"]));


        Promise.all(dailyPromises)
          .then(function(dailyList) {
            if (debug) sf.log("promises returned: " + dailyList.length);
            if (printToday)
              todayList = dailyList[0][sublist].filter(levelEightiesOnly);
            if (printTomorrow)
              tomorrowList = dailyList[(printToday ? 1 : 0)][sublist].filter(levelEightiesOnly);

            var fieldsFormatted = [];
            var fractalSort = function(a, b) {
              if (a.value < b.value) return -1;
              if (a.value > b.value) return 1;
              return 0;
            };
            if (printToday) {
              fieldsFormatted.push({
                "title": "Today's " + (sublist == 'fractals' ? "Fractal" : "Daily") + " Achievements",
                "short": false
              });
              var dayfields = compileDailyAchievements(todayList, (sublist == 'fractals'));
              dayfields.sort(fractalSort);
              fieldsFormatted = fieldsFormatted.concat(dayfields);

            }

            if (printTomorrow) {
              fieldsFormatted.push({
                "title": "Tomorow's " + (sublist == 'fractals' ? "Fractal" : "Daily") + " Achievements",
                //"value": day.name,
                "short": false
              });

              var tomorrowfields = compileDailyAchievements(tomorrowList, (sublist == 'fractals'));
              tomorrowfields.sort(fractalSort);
              fieldsFormatted = fieldsFormatted.concat(tomorrowfields);

            }

            var attachment = { //assemble attachment
              fallback: 'Daily Achievements',
              color: '#000000',
              thumb_url: (sublist == 'fractals') ? "https://wiki.guildwars2.com/images/3/38/Daily_Fractals.png" : "https://wiki.guildwars2.com/images/1/14/Daily_Achievement.png",
              fields: fieldsFormatted,
            };
            bot.reply(message, {
              attachments: [attachment],
            }, function(err, resp) {
              if (err || debug) bot.botkit.log(err, resp);
            });

          })
          .catch(function(error) {
            bot.reply(message, "I got an error that says " + error);
          });
      });
    },
    addHelp: function(helpFile) {
      helpFile.cheevo = "Display a report of several types of achievements. Achievements will show yellow and categories in purple.\nExample \'cheevo dungeon frequenter\'.";
      helpFile.cheevor = "Display a random achievement from a category, or random part of an achievement. Use as a suggestion for what to do next.";
      helpFile.cheevof = "Display a 'full' achievement. If you choose an achievement (not a category), displays tiers, and rewards.";
      helpFile.daily = "Prints a report of the daily achievements for today and tomorrow.";
      helpFile.today = "Prints a report of the daily achievements for today.";
      helpFile.tomorrow = "Prints a report of the daily achievements for tomorrow.";
      helpFile.fractals = "Prints a report of the daily fractals achievements for today and tomorrow.";
      helpFile.fractalstoday = "Prints a report of the daily fractals achievements for today.";
      helpFile.fractalstomorrow = "Prints a report of the daily fractals achievements for tomorrow.";
    },
    flipToggle: function() {
      if (toggle) toggle = false;
      else {
        toggle = true;

      }
    }
  };
  return ret;
}();