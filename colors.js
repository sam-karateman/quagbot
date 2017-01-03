///Template for new modules
//Author: Roger Lampe roger.lampe@gmail.com

var sf = require('./sharedFunctions.js');
var gw2api = require('./api.js');
var debug = false;
module.exports = function() {

	var ret = {
		addResponses: function(controller) {
			controller.hears(['^colorpreview(.*)', '^cp(.*)', '^preview(.*)'], 'direct_message,direct_mention,mention,ambient', function(bot, message) {

				var color = message.text.substring(message.text.indexOf(' ') + 1);
				if (debug) sf.log("preview matches: " + JSON.stringify(color));
				// if (!color) {
				// 	sf.replyWith("I didn't quite get that. Try 'help preview'.");
				// 	return;
				// }
				var cleanSearch = sf.removePunctuationAndToLower(color).replace(/\s+/g, '');
				if (!color || cleanSearch.length === 0) {
					bot.reply(message, "I didn't quite get that. Try 'help preview'.");
					return;
				}
				if (debug) sf.log("find color: " + cleanSearch);
				var colorsFound = [];
				var exactMatch = []
				for (var i in gw2api.data.colors) {
					var cleanColor = sf.removePunctuationAndToLower(gw2api.data.colors[i].name).replace(/\s+/g, '');
					if (cleanColor.includes(cleanSearch)) {
						colorsFound.push(gw2api.data.colors[i]);
					}
					if (cleanColor == cleanSearch) { //exact match cutout (for short names)
						if (debug) sf.log('exact match color ' + cleanSearch);
						exactMatch.push(gw2api.data.colors[i]);
					}
				}
				if(exactMatch.length > 0) colorsFound = exactMatch;

				var previewResponse = function(color) {
					return rgbToHex(color.cloth.rgb) + " " + color.name;
				};

				if (debug) sf.log(colorsFound.length + " matches found for search string");
				if (colorsFound.length === 0) { //no match
					bot.reply(message, "No color by that name. Please check the spelling and try again.");
				} else if (colorsFound.length == 1) { //exactly one. Ship it.
					bot.reply(message, previewResponse(colorsFound[0]));
				} else if (colorsFound.length > 10) { //too many matches in our 'contains' search, notify and give examples.
					var itemNameList = [];
					for (var n in colorsFound) {
						itemNameList.push(colorsFound[n].name);
					}
					bot.reply(message, {
						attachments: {
							attachment: {
								fallback: 'Too many items found in search.',
								text: "Criminey. I found " + colorsFound.length + ' items. Get more specific.\n' + itemNameList.join("\n")
							}
						}
					});
				} else { //10 items or less, allow user to colorsFound
					bot.startConversation(message, function(err, convo) {
						var listofItems = '';
						colorsFound.sort(function(a, b) {
							if (a.name < b.name) return -1;
							if (a.name > b.name) return 1;
							return 0;
						});
						for (var i in colorsFound) {
							listofItems += '\n' + [i] + ": " + colorsFound[i].name;
						}
						convo.ask('I found multiple colors with that name. Which number you mean? (say no to quit)' + listofItems, [{
							//number, no, or repeat
							pattern: new RegExp(/^(\d{1,2})/i),
							callback: function(response, convo) {
								//if it's a number, and that number is within our search results, print it
								var matches = response.text.match(/^(\d{1,2})/i);
								var selection = matches[0];
								if (selection < colorsFound.length) {
									convo.say(previewResponse(colorsFound[selection]));
								} else convo.repeat(); //invalid number. repeat choices.
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
								convo.say("Hum, that doesn't look right. Next time choose a number of the color you'd like to see.");
								convo.next();
							}
						}]);
					});
				}
			});


			controller.hears(['^color(.*)', '^mycolor(.*)', '^dye(.*)', '^mydye(.*)', '^joan$', '^joanrivers$'], 'direct_message,direct_mention,mention,ambient', function(bot, message) {
				bot.reply(message, {
					"text": "colors go!"
				});
				sf.setGlobalMessage(message);

				//establish everyone or just current user.
				var matches = message.text.match(/(my|joan)?(?:colors?|dyes?)?(cheme)?(?: (\w+)$)?/i);
				if (debug) sf.log("Color matches: " + JSON.stringify(matches));
				if (!matches) {
					sf.replyWith("I didn't quite get that. Try 'help color'.");
					return;
				}

				var usersToFetch;
				//If single user, make usersToFetch a list of that user, otherwise leave blank to fetch all users
				var isJoan = (matches[1] && matches[1].toLowerCase() == 'joan');
				if (matches[1] && (matches[1].toLowerCase() == 'my' || isJoan)) usersToFetch = [message.user];
				//if "cheme" i.e. colorscheme set isScheme to true
				var isScheme = ((matches[2] && matches[2].toLowerCase() == 'cheme') || isJoan);

				sf.storageUsersGetSynch(usersToFetch)
					.then(function(users) {
						return sf.userHasPermissionsAndReply(users, "unlocks");
					})
					.then(function(validUsers) {
						//if there's a list of user codes, filter out matching users
						if (matches[3]) {
							var requesterName = '';
							var selectedUsers = [];
							for (var c in validUsers) {
								if (validUsers[c].id == message.user)
									requesterName = "Hey, " + validUsers[c].dfid + sf.randomHonoriffic(validUsers[c].dfid, validUsers[c].id) + ". ";
								if (matches[3] && matches[3].indexOf(validUsers[c].dfid) > -1)
									selectedUsers.push(validUsers[c]);
							}

							selectedUsers = sf.arrayUnique(selectedUsers);
							//If no user id argument or only invalid arguments, print list and return
							if (selectedUsers.length < 1) {
								var replyString = '';
								for (var k in validUsers) {
									replyString += '\n' + validUsers[k].dfid + ': ' + validUsers[k].name;
								}
								bot.reply(message, requesterName + "Here's a list of eligible players of color. You can see a report by string together their codes like 'colors rsja'." + replyString + '\nTry colors <string> again.');
								return Promise.resolve(null);
							} else
								bot.reply(message, "(Using colors for " + selectedUsers.length + " players.)");

							//remove doubles
							validUsers = selectedUsers;
						}

						var userColorPromises = [];
						for (var usr in validUsers)
							if (validUsers[usr] !== null) {
								if (debug) sf.log(validUsers[usr].name + " is a valid user");
								userColorPromises.push(gw2api.promise.accountDyes(["all"], validUsers[usr].access_token));
							}
						if (debug) sf.log(userColorPromises.length + " account dye lists to fetch");
						if (userColorPromises.length === 0)
							return Promise.reject("there were no users with correct permissions.");
						else
							return Promise.all(userColorPromises);
					})
					.then(function(colorLists) {
						if (colorLists === null) return Promise.resolve();
						if (debug) sf.log("colorLists pre: " + JSON.stringify(colorLists));
						var singleUser = (colorLists.length < 2);
						var title = "No Dyes Whatsoever";
						var icon = "http://a1.mzstatic.com/us/r30/Purple3/v4/a9/3b/d3/a93bd379-6be6-c487-894c-7046c4481b9b/icon175x175.png";
						var text = "";
						//sort lists. Reduce to only common elements
						colorLists.sort(function(a, b) {
							return a.length - b.length;
						});
						var commonColors = colorLists.shift().filter(function(v) {
							return colorLists.every(function(a) {
								return a.indexOf(v) !== -1;
							});
						});

						var colorText = [];
						var colorIcons = [];
						var colorRGB = [];
						for (var id in commonColors) {
							var color = gw2api.findInData("id", commonColors[id], "colors");
							if (color && color.name) {
								colorText.push(color.name);
								if (isScheme)
									if (color.cloth && color.cloth.rgb)
										colorRGB.push(color.cloth.rgb);
									else
										colorRGB.push([0, 0, 0]);
							} else sf.log("Invalid color id: " + commonColors[id]);
							var item = gw2api.findInData("id", color.item, "items");
							if (item && item.icon)
								colorIcons.push(item.icon);
						}
						if (colorText.length > 0) {
							if (!isScheme) { //show list of dyes					
								title = singleUser ? "Your " + sf.randomOneOf(['Oscar Season', 'spring', 'summer', 'fall', 'winter']) + " palette of " + colorText.length + " colors!" : "All of the beautiful people are wearing:";
								icon = singleUser ? "https://render.guildwars2.com/file/109A6B04C4E577D9266EEDA21CC30E6B800DD452/66587.png" : "https://render.guildwars2.com/file/E3EAA9D80D4216D1E092915AFD90C069CEE8E470/222694.png";
								text = colorText.sort().join(", ");

								if (colorIcons.length > 0)
									icon = sf.randomOneOf(colorIcons);
								sf.replyWith({
									"username": "Joan Rivers' Ghost",
									"icon_url": "https://dwonnaknowwhatithink.files.wordpress.com/2014/09/joan-rivers-4.jpg",
									attachments: {
										attachment: {
											fallback: 'Look, Melissa! ' + colorText.length + ' dyes.',
											title: title,
											text: text,
											thumb_url: icon
										}
									}
								});
							} else {
								title = (singleUser ? "Your" : "Our") + " new Color Scheme:";
								var index = Math.floor(Math.random() * colorText.length);
								text += rgbToHex(colorRGB.splice(index, 1)[0]) + " " + colorText.splice(index, 1) + '\n';
								index = Math.floor(Math.random() * colorText.length);
								text += rgbToHex(colorRGB.splice(index, 1)[0]) + " " + colorText.splice(index, 1) + '\n';
								index = Math.floor(Math.random() * colorText.length);
								text += rgbToHex(colorRGB[index]) + " " + colorText[index];
								sf.replyWith({
									"text": "*" + title + "*\n" + text
								}, true);
								var fashionSpice = ["crashing Elton John's", 'sneaking into a hit', 'perking up your', 'sprucing up an old', 'spicing up that', 'giving some oomph to my', 'your', 'that', 'my', 'our'];
								var fashionAdj = ['Oscar', 'spring', 'summer', 'fall', 'winter', 'lobster', 'fancy-ass', 'casual', 'black tie'];
								var fashionNoun = ['season', 'pregnancy', 'outfit', 'night', 'evening', 'gala', 'costume party', 'vacation', 'seance', 'afterlife'];
								text = "What great colors for ";
								if ((Math.floor(Math.random() * 20) > 17))
									text += "Red Lobster's Lobsterfest, now featuring Ceaseless Shrimp and Bottomless Margarita Blasters! Red Lobster: Come for the food, leave! Back to you";
								else
									text += sf.randomOneOf(fashionSpice) + " " + sf.randomOneOf(fashionAdj) + " " + sf.randomOneOf(fashionNoun);
								text += sf.randomOneOf([", Mellis... Lessdremoth!", ", Lessdremoth.", ", Lessy!", ", people!", ", fashion fans!", ", bitches!"]);

								sf.replyWith({
									"username": "Joan Rivers' Ghost",
									"icon_url": "https://dwonnaknowwhatithink.files.wordpress.com/2014/09/joan-rivers-4.jpg",
									"text": text
								});
							}
						} else {
							sf.replyWith({
								"username": "Joan Rivers' Ghost",
								"icon_url": "http://cdn2.holytaco.com/wp-content/uploads/2014/07/joan-rivers.jpg",
								attachments: {
									attachment: {
										fallback: 'No dyes!',
										title: title,
										text: "There are no colors here.\nShut off the fucking camera.",
										thumb_url: icon
									}
								}
							});
						}
					})
					.catch(function(error) {
						sf.replyWith("I got an error that says " + error);
					});
			});
		},
		addHelp: function(helpFile) {
			helpFile.mycolors = "Returns a list of dyes you've discovered";
			helpFile.colors = "Returns a list of dyes common to all known users.";
			helpFile.mycolorscheme = "Randomly picks 3 colors from the list of dyes you've discovered";
			helpFile.colorscheme = "Randomly picks 3 colors from the list of dyes common to all known users.";
			helpFile.dye = "Alias for color. Can be substituted in all color commands, like mydyes and dyescheme.";
			helpFile.preview = "Preview a color with the very inaccurate swatch. Example: preview antique gold";
			helpFile.colorpreview = "Alias for preview: " + JSON.stringify(helpFile.preview);
			helpFile.cp = "Alias for preview: " + JSON.stringify(helpFile.preview);
		}
	};
	return ret;
}();
//'private' functions
function rgbToHex(rgb) {
	var componentToHex = function(c) {
		var hex = c.toString(16);
		return hex.length == 1 ? "0" + hex : hex;
	};
	if (debug) sf.log("RGB is: " + JSON.stringify(rgb));
	return "#" + componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);

}