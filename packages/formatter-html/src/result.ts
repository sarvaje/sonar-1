import * as path from 'path';

import cloneDeep = require('lodash/cloneDeep');

import { Category, Problem, Severity } from '@hint/utils-types';
import { loadJSONFile } from '@hint/utils-fs';
import { getCategoryName } from '@hint/utils-i18n';
import { FormatterOptions } from 'hint';

const thirdPartyServices = loadJSONFile(path.join(__dirname, 'configs', 'third-party-service-config.json'));
const categoryImages = loadJSONFile(path.join(__dirname, 'configs', 'category-images.json'));
const hintsWithoutDocs = ['optimize-image'];

/** Third party logo type. */
type ThirdPartyLogo = {
    name: string;
    url: string;
    alt: string;
};

/** Third party information. */
type ThirdPartyInfo = {
    logo: ThirdPartyLogo;
    link: string;
    details?: boolean;
};

/**
 * Represents information about a Hint.
 */
export class HintResult {
    /** Status of hint. */
    public status: string;
    /** Number of suggestions reported for this hint. */
    public count: number;
    /** Suggestions reported for this hint. */
    public problems: Problem[];
    /** Name of the hint. */
    public name: string;
    /** Third party information (when apply). */
    public thirdPartyInfo: ThirdPartyInfo;
    /** Indicate if there is documentation for this hint. */
    public hasDoc: boolean;

    public constructor(name: string, status: string, url: string, isScanner: boolean) {
        const baseName = name.split('/')[0];

        this.problems = [];

        this.name = name;
        this.status = status;
        this.count = 0;

        // Use `baseName` so multi-hints like `axe/aria` map to `axe`.
        this.thirdPartyInfo = thirdPartyServices[baseName] ? cloneDeep(thirdPartyServices[baseName]) : null;

        if (this.thirdPartyInfo) {
            this.thirdPartyInfo.link.replace(/%URL%/, url);
            if (!isScanner) {
                this.thirdPartyInfo.logo.url = this.thirdPartyInfo.logo.url.substr(1);
            }
        }

        this.hasDoc = !hintsWithoutDocs.includes(name);
    }

    /**
     * Add a new suggestion to the hint.
     * @param problem New suggestion.
     */
    public addProblem(problem: Problem) {
        this.problems.push(problem);
        this.count++;
    }
}

/**
 * Represents the information about a Category.
 */
export class CategoryResult {
    /** Number of suggestions in the category. */
    public hintsCount: number;
    /** Hints that have passed. */
    public passed: HintResult[];
    /** Hints that don't passed. */
    public hints: HintResult[];
    /** Category name. */
    public name: string;
    /** Localized category name. */
    public localizedName: string;
    /** Category image. */
    public image: string;
    /** Category status. */
    public status: string;
    /** Cache HintResults. */
    private cache: Map<string, HintResult> = new Map();
    /** URL analyzed. */
    public url: string;
    /** Is the result generated for the online scanner. */
    private isScanner: boolean;

    public constructor(name: string, url: string, isScanner: boolean, language?: string) {
        this.hints = [];
        this.passed = [];
        this.name = name;
        this.localizedName = getCategoryName(name.toLowerCase() as Category, language);

        this.hintsCount = 0;

        this.image = categoryImages[name.toLowerCase()];
        this.isScanner = isScanner;

        if (this.image && !isScanner) {
            this.image = this.image.substr(1);
        }

        this.status = 'finished';
        this.url = url;
    }

    /**
     * Return a Hint given a name.
     * @param name Hint name to get.
     */
    public getHintByName(name: string): HintResult | undefined {
        const lowerCaseName = name.toLowerCase();
        let hint = this.cache.get(lowerCaseName);

        if (!hint) {
            hint = this.hints.find((hi: HintResult) => {
                return hi.name.toLowerCase() === lowerCaseName;
            });

            if (hint) {
                this.cache.set(lowerCaseName, hint);
            }
        }

        return hint;
    }

    /**
     * Add a new Hint given a name and the status.
     * @param name Hint name.
     * @param status Hint status.
     */
    public addHint(name: string, status: string): HintResult {
        let hint = this.getHintByName(name);

        if (hint) {
            return hint;
        }

        hint = new HintResult(name, status, this.url, this.isScanner);

        if (status === 'pass') {
            this.passed.push(hint);
        } else {
            this.hints.push(hint);
        }

        return hint;
    }

    /**
     * Add a new suggestion to the categoroy.
     * @param problem Hint suggestion.
     */
    public addProblem(problem: Problem) {
        const hintId = problem.hintId;

        let hint = this.getHintByName(hintId);

        if (!hint) {
            hint = new HintResult(hintId, Severity[problem.severity].toString(), this.url, this.isScanner);

            this.hints.push(hint);
        }

        if (problem.severity !== Severity.off && problem.severity !== Severity.default) {
            this.hintsCount++;
        }

        hint.addProblem(problem);
    }
}

/**
 * Represents the result of an analysis.
 */
export default class AnalysisResult {
    /** Number of suggestions. */
    public hintsCount: number;
    /** Scan time. */
    public scanTime: string;
    /** When the scan was started (started in the online scanner). */
    public date: string;
    /** webhint version. */
    public version?: string;
    /** Link to the result (online scanner). */
    public permalink: string;
    /** List of categories. */
    public categories: CategoryResult[];
    /** URL analyzed. */
    public url: string;
    /** The analysis is finish. */
    public isFinish: boolean;
    /** Status of the analysis. */
    public status: string;
    /** Analysis id (mostly for the online scanner). */
    public id: string;
    /** If the results was generated in the online scanner. */
    public isScanner: boolean;
    /** Precentage of the analysis completed. */
    public percentage: number;
    /** Indicate if it is necessary to show the error message. */
    public showError: boolean;
    /** Cache for CategorieResults. */
    private cache: Map<string, CategoryResult> = new Map();

    public constructor(target: string, options: FormatterOptions) {
        this.url = target;
        this.hintsCount = 0;
        this.status = options.status ? options.status : 'finished';
        // Question: Should we have this here or in webhint.io?
        this.isFinish = this.status === 'finished' || this.status === 'error';
        this.showError = this.status === 'error';
        this.scanTime = this.parseScanTime(options.scanTime || 0);
        this.date = options.date!;
        this.version = options.version;
        this.permalink = '';
        this.id = '';
        this.isScanner = !!options.isScanner;
        this.percentage = 0;

        this.categories = [];
    }

    /**
     * Add a 0 to a time string if needed.
     */
    private pad = (timeString: string): string => {
        return timeString && timeString.length === 1 ? `0${timeString}` : timeString;
    };

    /**
     * Return a string representing the time.
     * @param scanTime Time in milliseconds.
     */
    private parseScanTime(scanTime: number): string {
        const seconds = Math.floor((scanTime / 1000) % 60);
        const minutes = Math.floor((scanTime / 1000 / 60) % 60);
        const hours = Math.floor((scanTime / 1000 / 3600));

        const minutesDisplay = this.pad(`${minutes}`);
        const secondsDisplay = this.pad(`${seconds}`);
        let time = `${minutesDisplay}:${secondsDisplay}`;

        if (hours > 0) {
            const hoursDisplay = this.pad(`${hours}`);

            time = `${hoursDisplay}:${time}`;
        }

        return time;
    }

    /**
     * Return a category given a name.
     * @param name Category name.
     */
    public getCategoryByName(name: string): CategoryResult | undefined {
        const lowerCaseName = name.toLowerCase();
        let category = this.cache.get(lowerCaseName);

        if (!category) {
            category = this.categories.find((cat: CategoryResult) => {
                return cat.name.toLowerCase() === lowerCaseName;
            });

            if (category) {
                this.cache.set(lowerCaseName, category);
            }
        }

        return category;
    }

    /**
     * Add a suggestion to the result.
     * @param problem New suggestion.
     */
    public addProblem(problem: Problem, language?: string): void {
        const categoryName: string = problem.category;

        let category: CategoryResult | undefined = this.getCategoryByName(categoryName);

        if (!category) {
            category = new CategoryResult(categoryName, this.url, this.isScanner, language);

            this.categories.push(category);
        }

        if (problem.severity === Severity.error || problem.severity === Severity.warning) {
            this.hintsCount++;
        }

        category.addProblem(problem);
    }

    /**
     * Add a new category to the result.
     * @param categoryName Category name.
     */
    public addCategory(categoryName: string, language?: string): void {
        let category = this.getCategoryByName(categoryName);

        if (category) {
            return;
        }

        category = new CategoryResult(categoryName, this.url, this.isScanner, language);

        this.categories.push(category);
    }

    /**
     * Remove a category from the results.
     * @param categoryName Category name.
     */
    public removeCategory(categoryName: string): void {
        const name = categoryName.toLowerCase();

        const category = this.getCategoryByName(name);

        if (category) {
            this.hintsCount -= category.hintsCount;

            const index = this.categories.indexOf(category);

            this.categories.splice(index, 1);

            this.cache.delete(name);
        }
    }
}
