'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const config = require('../config.json');
const defaultData = require('../data/default.js');
//const InventoryItemId = require('../data/item.js');
const map = require('../data/map.js');

if (config.discord.enabled) {
    router.get('/login', (req, res) => {
        res.redirect('/api/discord/login');
    });

    router.get('/logout', (req, res) => {
        req.session = null;
        res.redirect('/login');
    });
}

// Map endpoints
router.get(['/', '/index'], async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const data = await handlePage(req, res);
    res.render('index', data);
});

router.get('/index.js', async (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    const data = await handleHomeJs(req, res);
    res.render('index-js', data);
});

router.get('/index.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.render('index-css', defaultData);
});

// Location endpoints
router.get('/@/:lat/:lon', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const data = await handlePage(req, res);
    res.render('index', data);
});

router.get('/@/:lat/:lon/:zoom', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const data = await handlePage(req, res);
    res.render('index', data);
});

router.get('/@/:city', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const data = await handlePage(req, res);
    res.render('index', data);
});

router.get('/@/:city/:zoom', async (req, res) => {
    const data = await handlePage(req, res);
    res.render('index', data);
});

router.get('/purge', async (req, res) => {
    let target = req.query.target;
    if (!target || !target.startsWith('/')) {
        target = '/';
    }
    res.set('Clear-Site-Data', '"cache"');
    res.redirect(target);
});


const handlePage = async (req, res) => {
    const data = defaultData;
    data.bodyClass = config.style === 'dark' ? 'theme-dark' : '';
    data.tableClass = config.style === 'dark' ? 'table-dark' : '';

    data.max_pokemon_id = config.map.maxPokemonId;

    // Build available tile servers list
    const tileservers = getAvailableTileservers();
    data.available_tileservers_json = JSON.stringify(tileservers);

    await updateAvailableForms(config.icons);
    data.available_icon_styles_json = JSON.stringify(config.icons);

    // Build available items list
    const availableItems = [-3, -2, -1];
    //const keys = Object.keys(InventoryItemId);
    //keys.forEach(key => {
    //    const itemId = InventoryItemId[key];
    //    availableItems.push(itemId);
    //});
    data.available_items_json = JSON.stringify(availableItems);    

    // Build available areas list
    const areas = [];
    const areaKeys = Object.keys(config.areas).sort();
    areaKeys.forEach(key => {
        areas.push({ 'area': key });
    });
    data.areas = areas;

    // Available raid boss filters
    const availableRaidBosses = await map.getAvailableRaidBosses();
    data.available_raid_bosses_json = JSON.stringify(availableRaidBosses);

    // Available quest filters
    const availableQuestRewards = await map.getAvailableQuests();
    data.available_quest_rewards_json = JSON.stringify(availableQuestRewards);

    // Available nest pokemon filter
    const availableNestPokemon = await map.getAvailableNestPokemon();
    data.available_nest_pokemon_json = JSON.stringify(availableNestPokemon);

    // Custom navigation bar headers
    data.buttons_left = config.header.left;
    data.buttons_right = config.header.right;

    if (!config.discord.enabled || req.session.logged_in) {
        data.logged_in = true;
        data.username = req.session.username;
        if (config.discord.enabled) {
            if (req.session.valid) {
                const perms = req.session.perms;
                data.hide_map = !perms.map;
                data.hide_pokemon = !perms.pokemon;
                data.hide_raids = !perms.raids;
                data.hide_gyms = !perms.gyms;
                data.hide_pokestops = !perms.pokestops;
                data.hide_quests = !perms.quests;
                data.hide_lures = !perms.lures;
                data.hide_invasions = !perms.invasions;
                data.hide_spawnpoints = !perms.spawnpoints;
                data.hide_iv = !perms.iv;
                data.hide_pvp = !perms.pvp;
                data.hide_cells = !perms.s2cells;
                data.hide_submission_cells = !perms.submissionCells;
                data.hide_nests = !perms.nests;
                data.hide_weather = !perms.weather;
                data.hide_devices = !perms.devices;
            } else {
                console.log(req.session.username, 'Not authorized to access map');
                res.redirect('/login');
            }
        }
    }

    data.page_is_home = true;
    data.page_is_areas = true;
    data.show_areas = true;
    data.timestamp = Date.now();
    let lat = parseFloat(req.params.lat || config.map.startLat);
    let lon = parseFloat(req.params.lon || config.map.startLon);
    let city = req.params.city || null;
    let zoom = req.params.zoom;

    // Zoom specified for city
    if (city === null) {
        const tmpCity = req.params.lat;
        city = tmpCity;
        const tmpZoom = parseInt(req.params.lon);
        if (tmpZoom > 0) {
            zoom = tmpZoom;
        }
    }

    if (city) {
        for (var i = 0; i < areaKeys.length; i++) {
            const key = areaKeys[i];
            if (city.toLowerCase() === key.toLowerCase()) {
                const area = config.areas[key];
                lat = parseFloat(area.lat);
                lon = parseFloat(area.lon);
                if (!zoom) {
                    zoom = parseInt(area.zoom || config.map.startZoom);
                }
                break;
            }
        }
    }

    if ((zoom || config.map.startZoom) > config.map.maxZoom) {
        zoom = config.map.maxZoom;
    } else if ((zoom || config.map.startZoom) < config.map.minZoom) {
        zoom = config.map.minZoom;
    }

    data.start_lat = lat || 0;
    data.start_lon = lon || 0;
    data.start_zoom = zoom || config.map.startZoom || 12;
    data.lat = lat || 0;
    data.lon = lon || 0;
    data.zoom = zoom || config.map.startZoom || 12;
    data.min_zoom = config.map.minZoom || 10;
    data.max_zoom = config.map.maxZoom || 18;
    return data;
};

const handleHomeJs = async (req, res) => {
    const data = defaultData;
    data.max_pokemon_id = config.map.maxPokemonId;

    // Build available tile servers list
    const tileservers = getAvailableTileservers();
    data.available_tileservers_json = JSON.stringify(tileservers);

    // Build available forms list
    await updateAvailableForms(config.icons);
    data.available_icon_styles_json = JSON.stringify(config.icons);

    // Build available items list
    const availableItems = [-1, -2, -3, -4, -5, -6, -7, -8];
    //const keys = Object.keys(InventoryItemId);
    //keys.forEach(key => {
    //    const itemId = InventoryItemId[key];
    //    availableItems.push(itemId);
    //});
    data.available_items_json = JSON.stringify(availableItems);

    // Available raid boss filters
    const availableRaidBosses = await map.getAvailableRaidBosses();
    data.available_raid_bosses_json = JSON.stringify(availableRaidBosses);

    // Available quest filters
    const availableQuestRewards = await map.getAvailableQuests();
    data.available_quest_rewards_json = JSON.stringify(availableQuestRewards);

    // Available nest pokemon filter
    const availableNestPokemon = await map.getAvailableNestPokemon();
    data.available_nest_pokemon_json = JSON.stringify(availableNestPokemon);

    // Map settings
    data.min_zoom = req.query.min_zoom || config.map.minZoom;
    data.max_zoom = req.query.max_zoom || config.map.maxZoom;
    data.max_pokemon_id = config.maxPokemonId;
    //data.start_pokemon = req.params.start_pokemon
    //data.start_pokestop = req.params.start_pokestop
    //data.start_gym = req.params.start_gym
    return data;
};

const getAvailableTileservers = () => {
    const tileservers = {};
    const tileKeys = Object.keys(config.tileservers);
    if (tileKeys) {
        tileKeys.forEach(tileKey => {
            const tileData = config.tileservers[tileKey].split(';');
            tileservers[tileKey] = {
                url: tileData[0],
                attribution: tileData[1]
            };
        });
    }
    return tileservers;
};

const updateAvailableForms = async (icons) => {
    for (const icon of Object.values(icons)) {
        if (icon.path.startsWith('/')) {
            const pokemonIconsDir = path.resolve(__dirname, `../../static${icon.path}`);
            const files = await fs.promises.readdir(pokemonIconsDir);
            if (files) {
                const availableForms = [];
                files.forEach(file => {
                    const match = /^pokemon_icon_(.+)\.png$/.exec(file);
                    if (match !== null) {
                        availableForms.push(match[1]);
                    }
                });
                icon.pokemonList = availableForms;
            }
        } else {
            axios({
                method: 'GET',
                url: icon.path + '/index.json',
                responseType: 'json'
            }).then((response) => {
                icon.pokemonList = response ? response.data : [];
            });
        }
    }
};

module.exports = router;
