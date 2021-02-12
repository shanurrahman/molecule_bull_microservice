"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const lead_upload_interface_1 = require("../bull-queue/processors/lead-upload.interface");
const campaign_interface_1 = require("../campaign/interfaces/campaign.interface");
const admin_actions_interface_1 = require("../user/interfaces/admin-actions.interface");
const renameJson_1 = require("../utils/renameJson");
const xlsx_1 = require("xlsx");
const parseExcel_1 = require("../utils/parseExcel");
const upload_service_1 = require("./upload.service");
const push_notification_service_1 = require("./push-notification.service");
const sendMail_1 = require("../utils/sendMail");
let LeadService = class LeadService {
    constructor(leadModel, adminActionModel, campaignConfigModel, campaignModel, s3UploadService, pushNotificationService, emailService) {
        this.leadModel = leadModel;
        this.adminActionModel = adminActionModel;
        this.campaignConfigModel = campaignConfigModel;
        this.campaignModel = campaignModel;
        this.s3UploadService = s3UploadService;
        this.pushNotificationService = pushNotificationService;
        this.emailService = emailService;
    }
    async uploadMultipleLeadFiles(data) {
        const uniqueAttr = await this.campaignModel.findOne({ _id: data.campaignId }, { uniqueCols: 1 }).lean().exec();
        const ccnfg = await this.campaignConfigModel.find({ campaignId: data.campaignId }, { readableField: 1, internalField: 1, _id: 0 }).lean().exec();
        if (!ccnfg) {
            throw new Error(`Campaign with name ${data.campaignName} not found, create a campaign before uploading leads for that campaign`);
        }
        await this.adminActionModel.create({
            userid: data.userId,
            organization: data.organization,
            actionType: "lead",
            filePath: data.files[0].Location,
            savedOn: "s3",
            campaign: data.campaignId,
            fileType: "campaignConfig",
        });
        const result = await this.parseLeadFiles(data.files, ccnfg, data.campaignName, data.organization, data.uploader, data.userId, data.pushtoken, data.campaignId, uniqueAttr);
        return { files: data.files, result };
    }
    async parseLeadFiles(files, ccnfg, campaignName, organization, uploader, uploaderId, pushtoken, campaignId, uniqueAttr) {
        this.emailService.sendMail({
            to: 'shanur.cse.nitap@gmail.com',
            subject: "Your file has been uploaded for processing ...",
            text: "Sample text sent from amazon ses service"
        });
        files.forEach(async (file) => {
            const jsonRes = await parseExcel_1.default(file.Location, ccnfg);
            await this.saveLeadsFromExcel(jsonRes, campaignName, file.Key, organization, uploader, uploaderId, pushtoken, campaignId, uniqueAttr);
        });
    }
    async saveLeadsFromExcel(leads, campaignName, originalFileName, organization, uploader, uploaderId, pushtoken, campaignId, uniqueAttr) {
        const created = [];
        const updated = [];
        const error = [];
        for (const lead of leads) {
            let findByQuery = {};
            uniqueAttr.uniqueCols.forEach(col => {
                findByQuery[col] = lead[col];
            });
            findByQuery["campaignId"] = campaignId;
            common_1.Logger.debug(findByQuery);
            const { lastErrorObject, value } = await this.leadModel
                .findOneAndUpdate(findByQuery, Object.assign(Object.assign({}, lead), { campaign: campaignName, organization, uploader, campaignId }), { new: true, upsert: true, rawResult: true })
                .lean()
                .exec();
            if (lastErrorObject.updatedExisting === true) {
                updated.push(value);
            }
            else if (lastErrorObject.upserted) {
                created.push(value);
            }
            else {
                error.push(value);
            }
        }
        const created_ws = xlsx_1.utils.json_to_sheet(created);
        const updated_ws = xlsx_1.utils.json_to_sheet(updated);
        const wb = xlsx_1.utils.book_new();
        xlsx_1.utils.book_append_sheet(wb, updated_ws, "tickets updated");
        xlsx_1.utils.book_append_sheet(wb, created_ws, "tickets created");
        const wbOut = xlsx_1.write(wb, {
            bookType: "xlsx",
            type: "buffer",
        });
        const fileName = `result-${originalFileName}`;
        const result = await this.s3UploadService.uploadFileBuffer(fileName, wbOut);
        await this.adminActionModel.create({
            userid: uploaderId,
            organization,
            actionType: "lead",
            filePath: result.Location,
            savedOn: "s3",
            fileType: "lead",
            campaign: campaignId
        });
        this.pushNotificationService.sendPushNotification(pushtoken, {
            notification: {
                title: "File Upload Complete",
                icon: `https://cdn3.vectorstock.com/i/1000x1000/94/72/cute-black-cat-icon-vector-13499472.jpg`,
                body: `please visit ${result.Location} for the result`,
                tag: "some random tag",
                badge: `https://e7.pngegg.com/pngimages/564/873/png-clipart-computer-icons-education-molecule-icon-structure-area.png`,
            },
        }).then(result => {
            common_1.Logger.debug("successfully notified user");
        }, error => {
            common_1.Logger.debug("Failed to notified user about file upload");
        });
        return result;
    }
};
LeadService = __decorate([
    common_1.Injectable(),
    __param(0, mongoose_1.InjectModel("Lead")),
    __param(1, mongoose_1.InjectModel("AdminAction")),
    __param(2, mongoose_1.InjectModel("CampaignConfig")),
    __param(3, mongoose_1.InjectModel("Campaign")),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model,
        upload_service_1.UploadService,
        push_notification_service_1.PushNotificationService,
        sendMail_1.EmailService])
], LeadService);
exports.LeadService = LeadService;
//# sourceMappingURL=lead.service.js.map