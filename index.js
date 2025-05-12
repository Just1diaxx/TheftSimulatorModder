#!/usr/bin/env node

/**
 * Thief Simulator Save Editor
 * Copyright (c) 2023 [Il Tuo Nome]
 * Licensed under the MIT License
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const readline = require('readline');
const chalk = require('chalk');
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);

const CONFIG = {
    GAME_NAME: 'Thief Simulator',
    DEVELOPER: 'Noble Muffins',
    SAVE_FILE_PATTERN: /^playerdata/,
    BACKUP_FOLDER: 'save_backups',
    EDITABLE_FIELDS: {
        cash: { type: 'number', min: 0, max: 9999999 },
        experience: { type: 'number', min: 0, max: 9999999 },
        level: { type: 'number', min: 1, max: 100 },
        skillPoints: { type: 'number', min: 0, max: 999 },
        day: { type: 'number', min: 0, max: 999 },
        savedContracts: {
            type: 'object',
            fields: {
                reputationPoints: { type: 'number', min: -100, max: 100 },
                isDone: { type: 'boolean' },
                isTaken: { type: 'boolean' }
            }
        }
    }
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class SaveEditor {
    constructor() {
        this.profiles = [];
        this.selectedProfile = null;
        this.saveFilePath = null;
        this.saveData = null;
    }

    async init() {
        console.clear();
        this.printHeader();
        await this.checkBackupFolder();
        await this.detectSavePath();
        await this.listProfiles();
    }

    printHeader() {
        console.log(chalk.green.bold(`\n${'='.repeat(100)}`));
        console.log(chalk.green.bold(`${' '.repeat(40)}THIEF SIMULATOR MODDER`));
        console.log(chalk.green.bold(`${'='.repeat(100)}\n`));
    }

    async checkBackupFolder() {
        try {
            await fs.mkdir(CONFIG.BACKUP_FOLDER);
            console.log(chalk.yellow(`Created backup folder at: ${path.resolve(CONFIG.BACKUP_FOLDER)}`));
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.error(chalk.red('Error creating backup folder:'), err);
            }
        }
    }

    async detectSavePath() {
        const platform = os.platform();
        let savePath;

        switch (platform) {
            case 'win32':
                savePath = path.join(os.homedir(), 'AppData', 'LocalLow', CONFIG.DEVELOPER, CONFIG.GAME_NAME);
                break;
            case 'darwin':
                savePath = path.join(os.homedir(), 'Library', 'Application Support', `unity.${CONFIG.DEVELOPER}.${CONFIG.GAME_NAME.replace(' ', '')}`);
                break;
            case 'linux':
            default:
                savePath = path.join(os.homedir(), '.config', 'unity3d', CONFIG.DEVELOPER, CONFIG.GAME_NAME);
        }

        try {
            await fs.access(savePath);
            this.savePath = savePath;
            console.log(chalk.green(`Found save folder at: ${savePath}`));
        } catch (err) {
            console.error(chalk.red(`Save folder not found at: ${savePath}`));
            console.error(chalk.red('Please launch the game at least once to create save files.'));
            process.exit(1);
        }
    }

    async listProfiles() {
        try {
            const files = await fs.readdir(this.savePath);
            this.profiles = files.filter(name => name.startsWith('Profile_'));

            if (this.profiles.length === 0) {
                console.error(chalk.red('No profiles found.'));
                process.exit(1);
            }

            console.log(chalk.cyan('\nAvailable profiles:'));
            this.profiles.forEach((p, i) => console.log(`${chalk.yellow(`${i + 1}.`)} ${p}`));

            const answer = await this.question('\nSelect a profile (number): ');
            const index = parseInt(answer) - 1;

            if (isNaN(index) || index < 0 || index >= this.profiles.length) {
                throw new Error('Invalid profile selection');
            }

            this.selectedProfile = this.profiles[index];
            await this.loadProfile();
        } catch (err) {
            console.error(chalk.red('Error listing profiles:'), err.message);
            process.exit(1);
        }
    }

    async loadProfile() {
        try {
            const profilePath = path.join(this.savePath, this.selectedProfile);
            const files = await fs.readdir(profilePath);
            const playerFile = files.find(f => CONFIG.SAVE_FILE_PATTERN.test(f));

            if (!playerFile) {
                throw new Error('Player data file not found');
            }

            this.saveFilePath = path.join(profilePath, playerFile);
            await this.parseSaveFile();
        } catch (err) {
            console.error(chalk.red('Error loading profile:'), err.message);
            process.exit(1);
        }
    }

    async parseSaveFile() {
        try {
            await this.createBackup();

            const rawData = await fs.readFile(this.saveFilePath, 'utf-8');
            const jsonBlocks = [...rawData.matchAll(/\{[\s\S]*?\}(?=\s*\{|$)/g)].map(match => match[0]);

            if (jsonBlocks.length === 0) {
                throw new Error('No JSON data found in save file');
            }

            for (const block of jsonBlocks) {
                try {
                    const data = JSON.parse(block);
                    if (Object.keys(CONFIG.EDITABLE_FIELDS).some(key => key in data)) {
                        this.saveData = data;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!this.saveData) {
                throw new Error('No valid player data found in save file');
            }

            console.log(chalk.green('\nSuccessfully loaded player data:'));
            this.displayCurrentValues();
            await this.editMenu();
        } catch (err) {
            console.error(chalk.red('Error parsing save file:'), err.message);
            process.exit(1);
        }
    }

    async createBackup() {
        try {
            const timestamp = Date.now().toString()
            const backupFileName = `backup_${this.selectedProfile}_${timestamp}.json`;
            const backupPath = path.join(CONFIG.BACKUP_FOLDER, backupFileName);

            await fs.copyFile(this.saveFilePath, backupPath);
            console.log(chalk.yellow(`Backup created: ${backupPath}`));
        } catch (err) {
            console.error(chalk.red('Error creating backup:'), err.message);
        }
    }

    displayCurrentValues() {
        Object.keys(CONFIG.EDITABLE_FIELDS).forEach(key => {
            if (key === 'savedContracts') {
                console.log(chalk.cyan('\nSaved Contracts:'));
                this.saveData[key]?.forEach((contract, i) => {
                    console.log(`${chalk.yellow(`${i + 1}.`)} ${contract.id}`);
                    console.log(`   Reputation: ${contract.reputationPoints}`);
                    console.log(`   Done: ${contract.isDone}`);
                    console.log(`   Taken: ${contract.isTaken}`);
                });
            } else {
                console.log(`${chalk.cyan(key)}: ${chalk.yellow(this.saveData[key] || 0)}`);
            }
        });
    }

    async quickEditContracts() {
        console.log(chalk.cyan('\nQuick Contracts Editor:'));
        console.log('1. Mark all contracts as TAKEN');
        console.log('2. Mark all contracts as COMPLETED');
        console.log('3. Reset all contracts');
        console.log('4. Go back to edit contracts menu');

        const choice = await this.question('\nChoose an option: ');

        switch (choice) {
            case '1':
                this.saveData.savedContracts.forEach(c => c.isTaken = true);
                console.log(chalk.green('All contracts marked as TAKEN'));
                break;
            case '2':
                this.saveData.savedContracts.forEach(c => {
                    c.isDone = true;
                    c.isTaken = true;
                });
                console.log(chalk.green('All contracts marked as COMPLETED'));
                break;
            case '3':
                this.saveData.savedContracts.forEach(c => {
                    c.reputationPoints = 0;
                    c.isDone = false;
                    c.isTaken = false;
                });
                console.log(chalk.green('All contracts RESET'));
                break;
            case '4':
                return await this.editContractsMenu();
            default:
                console.log(chalk.red('Invalid option'));
        }

        await sleep(1500);
        await this.editContractsMenu();
    }

    async editContractsMenu() {
        console.log(chalk.cyan('\nContracts Editor:'));
        this.saveData.savedContracts?.forEach((contract, i) => {
            console.log(`${i + 1}. ${contract.id}`);
        });

        console.log('\nQ. Quick Edit Options');
        console.log('0. Back to main menu');

        const choice = await this.question('\nSelect contract to edit (number): ');
        if (choice === 'Q') return await this.quickEditContracts();
        if (choice === '0') return await this.editMenu();
        const index = parseInt(choice) - 1;

        if (isNaN(index) || index < -1 || index >= this.saveData.savedContracts.length) {
            console.log(chalk.red('Invalid selection'));
            return await this.editContractsMenu();
        }

        if (index === -1) return;

        const contract = this.saveData.savedContracts[index];

        console.log(chalk.cyan(`\nEditing ${contract.id}:`));
        console.log(`1. Reputation Points: ${contract.reputationPoints}`);
        console.log(`2. Is Done: ${contract.isDone}`);
        console.log(`3. Is Taken: ${contract.isTaken}`);

        const fieldChoice = await this.question('\nSelect field to edit: ');

        switch (fieldChoice) {
            case '1':
                const rep = await this.question(`New reputation points (current: ${contract.reputationPoints}): `);
                const repValue = parseInt(rep);
                if (!isNaN(repValue)) {
                    contract.reputationPoints = repValue;
                }
                break;
            case '2':
                contract.isDone = !contract.isDone;
                console.log(`Is Done set to: ${contract.isDone}`);
                await sleep(1000);
                break;
            case '3':
                contract.isTaken = !contract.isTaken;
                console.log(`Is Taken set to: ${contract.isTaken}`);
                await sleep(1000);
                break;
            default:
                console.log(chalk.red('Invalid choice'));
        }

        await this.editContractsMenu();
    }

    async restoreFromBackup() {
        const files = await fs.readdir(CONFIG.BACKUP_FOLDER);
        if (files.length === 0) {
            console.log(chalk.red('No backups found.'));
            return;
        }

        console.log(chalk.cyan('\nAvailable backups:'));

        const profileBackups = files.filter(f => f.includes(this.selectedProfile));
        profileBackups.forEach((f, i) => {
            const timestampStr = f.split('_')[3].replace('.json', '');
            const timestamp = parseInt(timestampStr);
            const formattedTimestamp = new Date(timestamp).toLocaleString();
            console.log(`${chalk.yellow(`${i + 1}.`)} ${formattedTimestamp}`);
        });


        const choice = await this.question('\nSelect a backup to restore (number), enter 0 to return: ');
        if (choice === '0') return await this.editMenu();
        const index = parseInt(choice) - 1;

        if (isNaN(index) || index < 0 || index >= files.length) {
            console.log(chalk.red('Invalid selection.'));
            return await this.restoreFromBackup();
        }

        const backupFile = path.join(CONFIG.BACKUP_FOLDER, files[index]);
        await fs.copyFile(backupFile, this.saveFilePath);
        console.log(chalk.green(`Backup restored from: ${backupFile}`));
    }

    async editMenu() {
        console.log(chalk.cyan('\nEdit options:'));
        console.log('1. Edit all basic values');
        console.log('2. Edit specific value');
        console.log('3. Edit contracts');
        console.log('4. Restore from backup')
        console.log('5. Save and exit');
        console.log('6. Exit without saving');

        const choice = await this.question('\nChoose an option: ');

        switch (choice) {
            case '1':
                await this.editAllValues();
                break;
            case '2':
                await this.editSpecificValue();
                break;
            case '3':
                await this.editContractsMenu();
                break;
            case '4':
                await this.restoreFromBackup();
                break;
            case '5':
                await this.saveChanges();
                break;
            case '6':
                console.log(chalk.yellow('\nExiting without saving changes.'));
                process.exit(0);
            default:
                console.log(chalk.red('\nInvalid option.'));
                await this.editMenu();
        }
    }

    async editAllValues() {
        for (const [key, config] of Object.entries(CONFIG.EDITABLE_FIELDS)) {
            const currentValue = this.saveData[key] || 0;
            const input = await this.question(
                `Enter new value for ${chalk.cyan(key)} (current: ${chalk.yellow(currentValue)}, min: ${config.min}, max: ${config.max}): `
            );

            if (input.trim()) {
                const value = parseInt(input);
                if (!isNaN(value) && value >= config.min && value <= config.max) {
                    this.saveData[key] = value;
                } else {
                    console.log(chalk.red(`Invalid value. Keeping current value: ${currentValue}`));
                }
            }
        }
        await this.editMenu();
    }

    async editSpecificValue() {
        console.log(chalk.cyan('\nSelect value to edit:'));
        Object.keys(CONFIG.EDITABLE_FIELDS).forEach((key, i) => {
            console.log(`${i + 1}. ${key}`);
        });

        const choice = await this.question('\nChoose a value to edit: ');
        const index = parseInt(choice) - 1;
        const keys = Object.keys(CONFIG.EDITABLE_FIELDS);

        if (isNaN(index) || index < 0 || index >= keys.length) {
            console.log(chalk.red('\nInvalid selection.'));
            return await this.editSpecificValue();
        }

        const key = keys[index];
        const config = CONFIG.EDITABLE_FIELDS[key];
        const currentValue = this.saveData[key] || 0;

        const input = await this.question(
            `Enter new value for ${chalk.cyan(key)} (current: ${chalk.yellow(currentValue)}, min: ${config.min}, max: ${config.max}): `
        );

        if (input.trim()) {
            const value = parseInt(input);
            if (!isNaN(value) && value >= config.min && value <= config.max) {
                this.saveData[key] = value;
                console.log(chalk.green(`\n${key} updated to: ${value}`));
            } else {
                console.log(chalk.red(`Invalid value. Keeping current value: ${currentValue}`));
            }
        }

        await this.editMenu();
    }

    async saveChanges() {
        try {
            const newData = JSON.stringify(this.saveData, null, 2);
            await fs.writeFile(this.saveFilePath, newData, 'utf-8');
            console.log(chalk.green('\nChanges saved successfully!'));
            process.exit(0);
        } catch (err) {
            console.error(chalk.red('\nError saving changes:'), err.message);
            process.exit(1);
        }
    }

    question(query) {
        return new Promise(resolve => rl.question(query, resolve));
    }
}

(async () => {
    try {
        const editor = new SaveEditor();
        await editor.init();
    } catch (err) {
        console.error(chalk.red('Fatal error:'), err);
        process.exit(1);
    }
})();