//API for Guildwars 2
//Originally by TimeBomb https://github.com/TimeBomb/GW2NodeLib
//Re-Authored: Roger Lampe roger.lampe@gmail.com

var config = {
	baseUrl: 'https://api.guildwars2.com/v2/',
	cacheTime: 360,
	cacheFile: null,
	cachePath: '',
	debug: false,
	retry: 2,
	dataLoadPageSize: 200,
	api: {
		quaggans: 'quaggans',
		build: 'build',
		characters: 'characters',
		colors: 'colors',
		currencies: 'currencies',
		accountWallet: 'account/wallet',
		achievements: 'achievements',
		achievementsCategories: 'achievements/categories',
		accountAchievements: 'account/achievements',
		accountDyes: 'account/dyes',
		items: 'items',
		recipes: 'recipes',
		account: 'account',
		accountBank: 'account/bank',
		accountInventory: 'account/inventory',
		accountMaterials: 'account/materials',
		tokeninfo: 'tokeninfo',
		dailies: 'achievements/daily',
		dailiesTomorrow: 'achievements/daily/tomorrow',
		skins: 'skins',
		titles: 'titles',
		minis: 'minis'
	},
	dao: { //roj42 - define useful parts of each return JSON item
		items: ["error", "id", "rarity", "text", "name", "description", "level", "chat_link", "icon", "details", "type"],
		recipes: ["error", "id", "output_item_id", "text", "output_item_count", "ingredients", "chat_link"],
		achievements: ["error", "id", "text", "name", "description", "requirement", "icon", "bits", "tiers", "flags", "rewards"],
		achievementsCategories: ["error", "id", "text", "name", "icon", "achievements"]
	},
	promisePoolMax: 100
};

// Fully load api into config; allows for per-uri cache times
for (var apiKey in config.api) {
	config.api[apiKey] = {
		uri: config.api[apiKey],
		cacheTime: config.cacheTime,
	};
}

//roj42 - we're storing cache in memory, so strip out unused items
var daoLoad = function(apiKey, rawJsonItem) {
	var daoAppliedItem = {};
	for (var i in config.dao[apiKey]) {
		if (typeof rawJsonItem[config.dao[apiKey][i]] !== undefined)
			daoAppliedItem[config.dao[apiKey][i]] = rawJsonItem[config.dao[apiKey][i]];
	}
	return daoAppliedItem;
};


// Set up the cache to work with or without a file; defaults to without
var fs = null;
var promisePool = config.promisePoolMax;
var cache = function() {
	var container = {};

	return {
		get: function(apiKey, key) {
			if (!container[apiKey]) return;
			return container[apiKey][key];
		},

		set: function(apiKey, key, value) {
			if (config.debug) console.log("Writing cache to file: " + config.cachePath + apiKey + config.cacheFile);
			if (!container[apiKey]) container[apiKey] = {};
			container[apiKey][key] = value;
			if (config.cacheFile !== null) {
				fs.writeFile(config.cachePath + apiKey + config.cacheFile, JSON.stringify(container[apiKey]), function(err) {
					if (err) throw err;
					else if (config.debug) console.log("Done writing.");
				});
			}
		},

		load: function(apiKey, obj) {
			if (!container[apiKey]) container[apiKey] = {};
			container[apiKey] = obj;
		},
	};
}();

var Gw2ApiLibException = function(message) {
	this.message = message;
	this.name = 'Gw2ApiLibException';
};

// For easily making HTTP request to API
var request = require('request');

// For converting JS object to URI params
var querystring = require('querystring');

// Invokes callback on requested JSON after it is retrieved via GET/cache; throws Gw2ApiLibException if there are bad arguments or an error accessing API
var apiRequest = function(apiKey, options, callback, bypassCache) {
	// Using argument structure [apiKey, callback]
	if ((typeof callback === 'undefined' || typeof callback === 'boolean') && typeof options === 'function') {
		// Using argument structure [apiKey, callback, bypassCache]
		if (typeof callback === 'boolean' && typeof bypassCache === 'undefined') {
			bypassCache = callback;
		}
		callback = options;
		options = null;
	}
	if (typeof apiKey === 'undefined' || typeof callback === 'undefined' || (typeof options !== 'undefined' && typeof options !== 'object')) {
		throw new Gw2ApiLibException('Bad arguments for apiRequest. Make sure all arguments are valid. Arguments: ' + JSON.stringify(arguments));
	}

	// Time to update and recache
	var cacheKey = apiKey + ((options !== undefined) ? '?' + decodeURIComponent(querystring.stringify(options)) : '');
	if (config.debug)
		if (typeof cache.get(apiKey, cacheKey) === 'undefined') console.log("cacheKey for " + apiKey + " undefined: " + cacheKey);
		else console.log(apiKey + ", bypass: " + (bypassCache ? true : false) + ", written: " + new Date(cache.get(apiKey, cacheKey).updateAt) + ", comparing now to: " + new Date(cache.get(apiKey, cacheKey).updateAt + config.api[apiKey].cacheTime * 1000));
	if (bypassCache || typeof cache.get(apiKey, cacheKey) === 'undefined' || Date.now() > (cache.get(apiKey, cacheKey).updateAt + config.api[apiKey].cacheTime * 1000)) {
		if (config.debug && options) console.log("options are " + decodeURIComponent(querystring.stringify(options)));
		var url = config.baseUrl + config.api[apiKey].uri + ((options !== undefined) ? '?' + decodeURIComponent(querystring.stringify(options)) : '');

		if (config.debug) console.log('Updating cache for API Key: ' + cacheKey + ' from URL: ' + url);
		//else console.log('Updating cache for API Key: ' + cacheKey);
		var retry = config.retry;
		var retryCallback = function(error, response, body) {
			//we're okay with
			//200 - success 
			//404 - no info returned, there will be a json object with 'text' we'll handle later
			//206 - partial info, some invalid ids or whatnot. Let the good stuff through
			if (error || !(response.statusCode == 200 || response.statusCode == 404 || response.statusCode == 206)) {
				var msg = ((typeof response !== 'undefined') ? '[Status Code ' + response.statusCode + '] ' : '') + 'There was an error requesting the API (URL ' + url + ')' + ((error !== null) ? ': ' + error : '');
				if (retry-- <= 0) { //Out of retries;				
					callback({
						'error': msg
					}, {
						options: options
					});
				} else {
					console.log(" Retrying: " + retry + " " + msg);
					request({
						uri: url,
						timeout: 10000
					}, retryCallback);
				}
				return; //roj42 - A thrown exception strangles the bot upstream, catching it doesn't stop a full halt.
				// throw new Gw2ApiLibException(msg);

			}
			if (response.statusCode == 206) console.log("Received a 206 error, not all ids fetched.");
			var headerSet = { //add header data for auto loading, if it came back
				options: options,
				pageSize: response.headers['x-page-size'],
				pageTotal: response.headers['x-page-total'],
				resultCount: response.headers['x-result-count'],
				resultTotal: response.headers['x-result-total']
			};
			cache.set(apiKey, cacheKey, {
				headers: headerSet,
				json: JSON.parse(body),
				updateAt: Date.now(),
			});

			callback(cache.get(apiKey, cacheKey).json, cache.get(apiKey, cacheKey).headers);
		};
		request({
			uri: url,
			timeout: 10000
		}, retryCallback);


		return;
	}
	// Only runs if already found in cache
	if (config.debug)
		console.log('Fetching cached API Key: ' + cacheKey);
	callback(cache.get(apiKey, cacheKey).json, cache.get(apiKey, cacheKey).headers);
};

// Return the public API
module.exports = function() {
	var ret = {
		// Returns true if successfully set, false if bad arguments (i.e. file doesn't exist)
		// roj42 - Now loads if file exists already, and just sets if files exists
		loadCacheFromFile: function(fileSuffix) {
			if (typeof fileSuffix === 'undefined' || fileSuffix === false) {
				config.cacheFile = null;
			} else {
				if (typeof fileSuffix !== 'string') {
					return false;
				}
				fs = require('fs');
				config.cacheFile = fileSuffix;

				for (var apiKey in config.api) {
					if (fs.existsSync(config.cachePath + apiKey + config.cacheFile) && (fs.statSync(config.cachePath + apiKey + config.cacheFile).size > 0)) {
						cache.load(apiKey, JSON.parse(fs.readFileSync(config.cachePath + apiKey + config.cacheFile, {
							encoding: 'utf8'
						})));
					} else if (config.debug) console.log("File " + config.cachePath + apiKey + config.cacheFile + " does not exist, will create on first cache save");
				}
			}
			return true;
		},
		setCachePath: function(path) {
			if (typeof path !== 'string') {
				config.cachePath = '';
				return false;
			}
			fs = require('fs');
			try {
				fs.statSync(path);
			} catch (e) {
				fs.mkdirSync(path);
			}
			config.cachePath = path;
			return true;
		},
		// Returns true if successful, false if bad arguments
		setCacheTime: function(seconds, apiKey) {
			// Using argument structure [seconds]
			if (config.debug) console.log("Setting cache of " + seconds + " sec on " + (apiKey ? apiKey : 'all apikeys'));
			if (typeof seconds === 'undefined') {
				seconds = apiKey;
				apiKey = null;
			}
			if (typeof seconds !== 'number') {
				if (config.debug) console.log('setCacheTime unsuccessful: seconds NAN');
				return false;
			}

			// Update default cache time and all api keys using default cache time
			if (apiKey === null) {
				var oldCacheTime = config.cacheTime;
				config.cacheTime = seconds;
				for (var aKey in config.api) {
					// Only updates cache time if using (old) default cache time
					if (config.api[aKey].cacheTime === oldCacheTime) {
						config.api[aKey].cacheTime = config.cacheTime;
					}
				}
				if (config.debug) console.log('setCacheTime successful; config.api: ' + JSON.stringify(config.api));
			} else if (!(apiKey in config.api)) {
				if (config.debug) console.log('setCacheTime unsuccessful: api key does not exist');
				return false;
			} else {
				config.api[apiKey].cacheTime = seconds;
				if (config.debug) console.log('setCacheTime successful; config.api.' + apiKey + ': ' + JSON.stringify(config.api[apiKey]));
			}

			return true;
		},

		// Returns true if successful, false if apiKey not found
		resetCacheTime: function(apiKey) {
			if (typeof apiKey === 'undefined') {
				for (var aKey in config.api) {
					config.api[aKey].cacheTime = config.cacheTime;
				}
			} else if (!(apiKey in config.api)) {
				return false;
			} else {
				config.api[apiKey].cacheTime = config.cacheTime;
			}
			return true;
		},
	};

	// Allows public access to apiRequest for each apiKey, i.e. this.apiKey(function, [optional] object, [optional] boolean)
	var entryPointFunction = function(apiKey) {
		return function(callback, params, bypassCache) {
			if (typeof callback !== 'function' || (typeof params !== 'undefined' && typeof params !== 'object')) {
				return false;
			}
			apiRequest(apiKey, params, callback, bypassCache);
			return true;
		};
	};
	//roj42 - promise form of individual apikeys
	var promiseFunction = function(apiKey) {
		return function(idsToFetch, access_token, bypassCache) {

			// Return a new promise.
			return new Promise(function(resolve, reject) {
				var task = function() {
					if (config.debug) console.log(apiKey + " promise fetching " + JSON.stringify(idsToFetch));
					if (idsToFetch.length === 0) resolve([]);
					else if (idsToFetch.length > config.dataLoadPageSize) reject("Limit " + config.dataLoadPageSize + " ids per fetch");
					else {
						var optionsObj = {
							ids: idsToFetch.join(',')
						};

						if (access_token)
							optionsObj.access_token = access_token;

						var listCallback = function(jsonRes, headers) {
							promisePool++;
							if (config.debug) console.log(apiKey + " promise for " + idsToFetch.length + " ids, fetching now");

							if (jsonRes.text || jsonRes.err || jsonRes.error) {
								if (config.debug) console.log(apiKey + " promise error: " + JSON.stringify(jsonRes));
								if(jsonRes.text && jsonRes.text == "all ids provided are invalid"){
									resolve([]);
								}
								else reject(jsonRes.text || jsonRes.err || jsonRes.error);
							} else {
								if (config.debug) console.log(apiKey + " promise results: " + jsonRes.length);
								resolve(jsonRes);
							}
						};
						promisePool--;
						ret[apiKey](listCallback, optionsObj, bypassCache);
					}
				};
				//wait on pool
				if (promisePool < 1) {
					if(config.debug) console.log("pool max, waiting: "+promisePool);
					setTimeout(task, 1000);
					return;
				} else {
					if(config.debug) console.log("pool at "+promisePool);
					task();
				}

			});
		};
	};
	//roj42 - grab non-API forge recipes from the kind people at gw2profits
	var forgeOptions = {
		method: 'GET',
		url: 'http://www.gw2profits.com/json/forge?include=name',
		headers: {
			'postman-token': '558fed07-854b-6b03-e7c8-a776d87adfb4',
			'cache-control': 'no-cache'
		}
	};
	ret.forgeRequest = function(callback) {
		if (typeof cache.get('recipes', 'forgeRecipes') === 'undefined' || Date.now() > (cache.get('recipes', 'forgeRecipes').updateAt + (config.api[apiKey].cacheTime * 1000))) {

			request(forgeOptions, function(error, response, body) {
				if (error) return new Error(error);
				cache.set('recipes', 'forgeRecipes', {
					json: JSON.parse(body),
					updateAt: Date.now(),
				});
				callback(cache.get('recipes', 'forgeRecipes').json);
			});
		} else callback(cache.get('recipes', 'forgeRecipes').json);
	};
	var statusOptions = {
		method: 'GET',
		url: 'https://api.guildwars2.com'
	};
	ret.APIServerStatus = function(callback) {
		request(statusOptions, function(error, response, body) {
			if (error) return new Error(error);
			var res = JSON.parse(body);
			if (debug) console.log('status check response body: ' + JSON.stringify(res));
			switch (res.length) {
				case 0:
					callback('Down!');
					break;
				case 2:
					callback('Up!');
					break;
				default:
					sf.log("Odd server status: " + JSON.stringify(res));
					callback("Up, but weird!\n" + JSON.stringify(res));
			}
		});
	};

	//roj42 - methods to load ALL of a specific endpoint
	ret.daoLoad = daoLoad;
	ret.data = [];
	ret.data.forged = [];
	ret.promise = [];
	ret.loaded = [];
	for (var apiKey in config.api) {
		// Returns true if successful, false if bad arguments
		ret[apiKey] = entryPointFunction(apiKey);
		ret.data[apiKey] = [];
		ret.promise[apiKey] = promiseFunction(apiKey);
		ret.loaded[apiKey] = false;
	}
	ret.findInData = function(key, value, apiKey) {
		for (var i in ret.data[apiKey]) {
			if (ret.data[apiKey][i][key] == value) {
				return ret.data[apiKey][i];
			}
		}
	};
	ret.load = function(apiKey, idsToFetch, bypass, doneCallback, errorCallback) {
		if (!ret[apiKey]) {
			if (errorCallback) errorCallback("no apiKey for " + apiKey);
			else console.log("no apiKey for " + apiKey);
			return;
		} //check apiKey
		ret.loaded[apiKey] = false; //'finished' flag
		ret.data[apiKey].length = 0; //blank existing data

		//If fetching all, do a test ping to get the total size
		if (config.debug) 
		console.log("Launching fetch for " + apiKey + (idsToFetch ? " size of ids is: " + idsToFetch.length : ", size fetch first"));
		new Promise(function(resolve, reject) {
			if (!idsToFetch || idsToFetch == 'all') { //this is an endpoint that gives a list of ids, fetch that list
				var pageCountFromHeaders = function(res, headers) {
					if (config.debug) 
					console.log("result size fetch:" + headers.resultTotal);
					if (res.error) reject(res);
					else resolve(res);
				};
				ret[apiKey](pageCountFromHeaders, idsToFetch, bypass);

			} else { //directly fetch a compiled list of ids
				resolve(idsToFetch);
			}
		}).then(function(idList) {
			if (config.debug) 
			console.log("loading ids total: " + idList.length);
			//loop <total> times and push promises
			var loadPromises = [];
			var page = 0;
			while (page <= (idList.length)) {
				var ids = idList.slice(page, page + config.dataLoadPageSize);
				page += config.dataLoadPageSize;
				loadPromises.push(ret.promise[apiKey](ids, page + "/" + idList.length, bypass));
			}
			return Promise.all(loadPromises);
		}).then(function(allResults) {
			var total = 0;
			allResults.forEach(function(v) {
				if (apiKey in config.dao) {
					for (var item in v) {
						if (config.debug && total === 0 && item == '0') console.log("sample dao:\n" + JSON.stringify(v[item]) + "\nbecomes\n" + JSON.stringify(daoLoad(apiKey, v[item])));
						ret.data[apiKey] = ret.data[apiKey].concat(daoLoad(apiKey, v[item]));
					}
				} else {
					ret.data[apiKey] = ret.data[apiKey].concat(v);
				}
				total += v.length;
			});
			if(config.debug) console.log("promises fufilled " + allResults.length + ", total items: " + total + ", data length:" + ret.data[apiKey].length);
			ret.loaded[apiKey] = true;
			doneCallback(apiKey);
		}).catch(function(error) {
			if (errorCallback) errorCallback(apiKey, "I got an error on my way to promise land from cheevos. Send help!\nTell them " + error);
		});
	};

	return ret;
}();